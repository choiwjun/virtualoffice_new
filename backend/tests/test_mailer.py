"""메일 발송 어댑터 — 채널 선택과 안전한 기본값.

E4는 "메일 없이 관리자가 링크를 전달"로 열었다(D36). 발송 채널만 얹으면 self-service
forgot-password(E9)가 같은 토큰 코드로 열린다. SMTP/SES 결정에 코드가 묶이지 않도록
인터페이스를 두고, 미설정 환경에서 조용히 "보낸 척"하지 않는지를 여기서 고정한다.
"""

from app.services.mailer import (
    ConsoleMailer,
    Mail,
    SmtpMailer,
    get_mailer,
    password_link_mail,
)


def test_default_backend_is_console(monkeypatch):
    """미설정이면 console — 운영에서 조용히 성공하지 않고 로그에 남는다."""
    from app.config import settings

    monkeypatch.setattr(settings, "mail_backend", "", raising=False)
    assert isinstance(get_mailer(), ConsoleMailer)


def test_smtp_backend_selected(monkeypatch):
    from app.config import settings

    monkeypatch.setattr(settings, "mail_backend", "smtp", raising=False)
    monkeypatch.setattr(settings, "smtp_host", "smtp.example.com", raising=False)
    assert isinstance(get_mailer(), SmtpMailer)


def test_smtp_without_host_falls_back(monkeypatch):
    """호스트 없이 smtp를 고르면 연결 시점에 터지는 대신 console로 떨어진다."""
    from app.config import settings

    monkeypatch.setattr(settings, "mail_backend", "smtp", raising=False)
    monkeypatch.setattr(settings, "smtp_host", "", raising=False)
    assert isinstance(get_mailer(), ConsoleMailer)


def test_unknown_backend_falls_back(monkeypatch):
    from app.config import settings

    monkeypatch.setattr(settings, "mail_backend", "carrier-pigeon", raising=False)
    assert isinstance(get_mailer(), ConsoleMailer)


def test_console_mailer_never_raises():
    """발송이 링크 발급을 되돌리면 안 된다 — 기본 채널은 절대 예외를 올리지 않는다."""
    ConsoleMailer().send(Mail(to="a@b.c", subject="s", body="b"))


def test_invitation_and_reset_differ_in_wording():
    url = "http://localhost:3000/set-password?token=abc"
    inv = password_link_mail(to="a@b.c", name="김앨리스", company="호라이즌", url=url, invitation=True)
    rst = password_link_mail(to="a@b.c", name="김앨리스", company="호라이즌", url=url, invitation=False)

    assert url in inv.body and url in rst.body
    assert "7일" in inv.body and "24시간" in rst.body
    assert inv.subject != rst.subject
    # 토큰은 링크 안에만 — 제목이나 다른 곳에 새면 메일 미리보기·로그에 노출된다.
    assert "abc" not in inv.subject


def test_body_tells_recipient_what_inaction_means():
    """본인이 요청하지 않았을 때 무엇을 해야 하는지 적혀 있어야 한다(피싱 오인·불안 방지)."""
    body = password_link_mail(
        to="a@b.c", name="홍길동", company="호라이즌", url="http://x/y", invitation=False
    ).body
    assert "무시" in body
