"""메일 발송 어댑터 — 발송 채널을 갈아끼울 수 있는 이음매.

E4는 "메일 없이 관리자가 링크를 전달"로 축소해 열었다(D36). 남은 건 발송 채널뿐이고,
`tokens.set_password_url()`이 이미 링크 본문을 만든다. 여기서 채널을 추상화해 두면
셀프서비스 forgot-password(23 E9)가 같은 토큰 코드로 열린다.

**SMTP / SES 중 무엇을 쓸지는 아직 결정되지 않았다.** 그 결정에 코드가 묶이지 않도록
인터페이스를 먼저 두고, 표준 라이브러리만으로 되는 SMTP를 기본 구현으로 둔다. SES는
`SesMailer`를 추가하고 `MAIL_BACKEND=ses`로 고르면 되며, 나머지 코드는 바뀌지 않는다.

기본값은 **console**이다 — 설정하지 않은 환경에서 조용히 "보낸 척"하지 않도록, 무엇을
어디로 보내려 했는지 로그로 남긴다. 운영에서 미설정 상태로 뜨는 사고는 `MAIL_BACKEND`를
명시하지 않은 것으로 드러난다.
"""

from __future__ import annotations

import logging
import smtplib
from dataclasses import dataclass
from email.message import EmailMessage
from typing import Protocol

from app.config import settings

logger = logging.getLogger(__name__)


@dataclass(frozen=True)
class Mail:
    to: str
    subject: str
    """본문은 평문만 둔다 — HTML 메일은 템플릿·인라인 CSS·클라이언트 호환이 따라붙는다.
    링크 하나를 전달하는 데 그 비용을 먼저 낼 이유가 없다."""
    body: str


class Mailer(Protocol):
    def send(self, mail: Mail) -> None: ...


class ConsoleMailer:
    """로그로만 남긴다 — dev 기본값. 발송 실패를 성공으로 오인하지 않게 한다."""

    def send(self, mail: Mail) -> None:
        logger.info(
            "[mail:console] to=%s subject=%s\n%s", mail.to, mail.subject, mail.body
        )


class SmtpMailer:
    """표준 라이브러리 SMTP. 사내 릴레이·SendGrid·SES SMTP 엔드포인트 모두 이걸로 붙는다."""

    def __init__(self, host: str, port: int, user: str, password: str, sender: str, use_tls: bool):
        self.host, self.port = host, port
        self.user, self.password = user, password
        self.sender, self.use_tls = sender, use_tls

    def send(self, mail: Mail) -> None:
        msg = EmailMessage()
        msg["From"] = self.sender
        msg["To"] = mail.to
        msg["Subject"] = mail.subject
        msg.set_content(mail.body)
        with smtplib.SMTP(self.host, self.port, timeout=10) as smtp:
            if self.use_tls:
                smtp.starttls()
            if self.user:
                smtp.login(self.user, self.password)
            smtp.send_message(msg)


def get_mailer() -> Mailer:
    """`MAIL_BACKEND` 설정에 따른 어댑터. 미설정·미지원 값은 console(안전한 쪽)."""
    backend = (settings.mail_backend or "console").strip().lower()
    if backend == "smtp":
        if not settings.smtp_host:
            logger.warning("[mail] MAIL_BACKEND=smtp인데 SMTP_HOST가 비어 있다 — console로 폴백")
            return ConsoleMailer()
        return SmtpMailer(
            host=settings.smtp_host,
            port=settings.smtp_port,
            user=settings.smtp_user,
            password=settings.smtp_password,
            sender=settings.mail_from or settings.smtp_user,
            use_tls=settings.smtp_use_tls,
        )
    if backend != "console":
        logger.warning("[mail] 알 수 없는 MAIL_BACKEND=%s — console로 폴백", backend)
    return ConsoleMailer()


def password_link_mail(*, to: str, name: str, company: str, url: str, invitation: bool) -> Mail:
    """초대/재설정 링크 메일. 두 흐름은 문구만 다르다(D36: 코드가 같다)."""
    what = "계정 설정" if invitation else "비밀번호 재설정"
    valid = "7일" if invitation else "24시간"
    lead = (
        f"{company}의 가상오피스 계정이 만들어졌습니다."
        if invitation
        else f"{company} 가상오피스 비밀번호 재설정이 요청되었습니다."
    )
    return Mail(
        to=to,
        subject=f"[{company}] {what} 안내",
        body=(
            f"{name}님, 안녕하세요.\n\n"
            f"{lead}\n"
            f"아래 링크에서 비밀번호를 설정하시면 바로 로그인됩니다.\n\n"
            f"{url}\n\n"
            f"이 링크는 {valid} 동안 한 번만 쓸 수 있습니다.\n"
            f"본인이 요청하지 않았다면 이 메일을 무시하세요 — 링크를 열지 않으면 아무 일도 일어나지 않습니다.\n"
        ),
    )
