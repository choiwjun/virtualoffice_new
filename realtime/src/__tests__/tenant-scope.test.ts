/**
 * tenant-scope.test.ts — 실시간 방의 테넌트 경계 (22 T0-1 잔여 · 24-spec §1-7).
 *
 * 이전에는 onAuth가 JWT의 `sub`/`email`만 취하고 `companyId`는 **클라이언트가 준 값**을
 * 그대로 썼다. 그래서 회사 2의 유저가 회사 1의 방에 들어가 `companyId: "1"`을 주장하면
 * 그 층의 아바타·프레즌스를 그대로 볼 수 있었다.
 *
 * 지금은 토큰의 `company_id`가 정본이고, 방의 회사와 다르면 join이 거부된다.
 *
 * Run with:  npm test
 */

import jwt from "jsonwebtoken";
import {
  OfficeRoom,
  companyMatchesRoom,
  normalizeCompanyId,
  DEFAULT_COMPANY_ID,
  type JoinOptions,
} from "../rooms/OfficeRoom";
import { JWT_SECRET, JWT_ALGORITHM } from "../config";

let passed = 0;
let failed = 0;

function assert(cond: boolean, label: string): void {
  if (cond) {
    passed++;
    console.log(`  PASS  ${label}`);
  } else {
    failed++;
    console.error(`  FAIL  ${label}`);
  }
}

function eq<T>(actual: T, expected: T, label: string): void {
  assert(actual === expected, `${label} (expected ${String(expected)}, got ${String(actual)})`);
}

function makeRoom(companyId: string): OfficeRoom {
  const r = new OfficeRoom();
  (r as unknown as { listing: { remove(): void } }).listing = { remove() {} };
  (r as unknown as { companyId: string }).companyId = companyId;
  return r;
}

function token(claims: Record<string, unknown>): string {
  return jwt.sign(claims, JWT_SECRET, { algorithm: JWT_ALGORITHM });
}

async function authOf(room: OfficeRoom, options: JoinOptions): Promise<JoinOptions | Error> {
  try {
    return await room.onAuth({} as never, options);
  } catch (e) {
    return e as Error;
  }
}

async function main(): Promise<void> {
  console.log("\n[1] 정규화·비교 헬퍼");
  {
    eq(normalizeCompanyId(1), "1", "정수 클레임 → 문자열");
    eq(normalizeCompanyId("2"), "2", "문자열 클레임 유지");
    eq(normalizeCompanyId(null), null, "null → null(주장 없음)");
    eq(normalizeCompanyId(undefined), null, "undefined → null");
    eq(normalizeCompanyId(""), null, "빈 문자열 → null");

    assert(companyMatchesRoom("1", "1"), "같은 회사 통과");
    assert(!companyMatchesRoom("2", "1"), "다른 회사 차단");
    assert(companyMatchesRoom("7", DEFAULT_COMPANY_ID), "데모 방(테넌트 미지정)은 통과");
  }

  console.log("\n[2] 토큰 회사 == 방 회사 → 허용");
  {
    const room = makeRoom("1");
    const res = await authOf(room, { jwt: token({ sub: "1001", email: "a@c1.local", company_id: 1 }) });
    assert(!(res instanceof Error), `join 허용 (${res instanceof Error ? res.message : "ok"})`);
    if (!(res instanceof Error)) {
      eq(res.companyId, "1", "companyId가 토큰 값으로 채워짐");
      eq(res.userId, "1001", "userId는 토큰 sub");
    }
  }

  console.log("\n[3] 토큰 회사 != 방 회사 → 거부");
  {
    const room = makeRoom("1");
    const res = await authOf(room, { jwt: token({ sub: "2001", company_id: 2 }) });
    assert(res instanceof Error, "타사 방 join 거부");
    if (res instanceof Error) assert(/forbidden/.test(res.message), `사유가 forbidden (${res.message})`);
  }

  console.log("\n[4] 클라이언트가 companyId를 위조해도 토큰이 이긴다");
  {
    const room = makeRoom("1");
    // 회사 2 유저가 "나는 회사 1"이라고 주장 → 거부돼야 한다.
    const res = await authOf(room, {
      companyId: "1",
      jwt: token({ sub: "2001", company_id: 2 }),
    });
    assert(res instanceof Error, "위조된 companyId로도 타사 방 진입 불가");
  }
  {
    const room = makeRoom("1");
    // 회사 1 유저가 엉뚱하게 "회사 9"라고 주장 → 토큰 값(1)으로 덮어써 통과.
    const res = await authOf(room, {
      companyId: "9",
      jwt: token({ sub: "1001", company_id: 1 }),
    });
    assert(!(res instanceof Error), "자사 방은 통과");
    if (!(res instanceof Error)) eq(res.companyId, "1", "주장한 9가 아니라 토큰의 1로 교정");
  }

  console.log("\n[5] company_id 클레임 없는 구 토큰 (하위호환)");
  {
    const room = makeRoom("1");
    const res = await authOf(room, { jwt: token({ sub: "1001", email: "old@c1.local" }) });
    assert(!(res instanceof Error), "구 토큰은 테넌트 주장이 없어 통과(백엔드와 동일 정책)");
  }

  console.log("\n[6] 서명이 틀린 토큰");
  {
    const room = makeRoom("1");
    const forged = jwt.sign({ sub: "9", company_id: 1 }, "wrong-secret", { algorithm: "HS256" });
    const res = await authOf(room, { jwt: forged });
    assert(res instanceof Error, "위조 서명 거부");
    if (res instanceof Error) assert(/unauthorized/.test(res.message), `사유가 unauthorized (${res.message})`);
  }

  console.log("\n[7] 데모 방(테넌트 미지정)은 어떤 회사든 허용 — 로컬/데모 호환");
  {
    const room = makeRoom(DEFAULT_COMPANY_ID);
    const res = await authOf(room, { jwt: token({ sub: "1", company_id: 42 }) });
    assert(!(res instanceof Error), "데모 방 join 허용");
  }

  console.log(`\n${"=".repeat(56)}`);
  console.log(`tenant-scope: ${passed} passed, ${failed} failed`);
  if (failed > 0) process.exit(1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
