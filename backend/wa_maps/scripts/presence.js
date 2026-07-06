/**
 * presence.js — VirtualOffice WorkAdventure Presence Tracker
 *
 * WA 맵에 연결된 클라이언트 사이드 scripting 파일.
 * zone 진입/이탈·유휴 이벤트를 감지해 FastAPI POST /api/wa/presence 로 전송.
 *
 * D13 7종 상태: offline, online, working, meeting, focus, away, external
 * D20-c: GPS 코드 금지 — 위치/GPS 로직 없음.
 * D24: 회의실 명시 입장 — zone 진입 이벤트가 명시적 입장 확정.
 *
 * WA Scripting API 참조: https://docs.workadventu.re/developer/map-scripting/
 */

/** FastAPI 백엔드 presence 엔드포인트 (상대경로) */
const BACKEND_URL = "/api/wa/presence";

/** D13: 5분 무입력 → AWAY 전이 임계값 */
const IDLE_TIMEOUT_MS = 5 * 60 * 1000;

/** 유휴 체크 인터벌 (1분) */
const IDLE_CHECK_INTERVAL_MS = 60 * 1000;

/**
 * 백엔드에 presence 이벤트 POST.
 * @param {number} employeeId
 * @param {string} kind - WaEventKind 문자열
 * @param {Object} [extra] - zone_name / variable_name / variable_value 등
 */
async function postPresence(employeeId, kind, extra) {
    const body = { employee_id: employeeId, kind };
    if (extra) {
        Object.assign(body, extra);
    }
    try {
        const resp = await fetch(BACKEND_URL, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(body),
        });
        if (!resp.ok) {
            console.warn("[presence.js] backend error:", resp.status, await resp.text());
        }
    } catch (err) {
        // 네트워크 장애는 무시 (비동기 fire-and-forget)
        console.warn("[presence.js] fetch failed:", err);
    }
}

/**
 * 플레이어 이름 → 간단한 정수 해시 (employee_id 프록시).
 * 운영 환경: WA 플레이어 태그/상태 변수에서 실 employee_id 조회.
 * @param {string} name
 * @returns {number}
 */
function hashName(name) {
    let h = 0;
    for (let i = 0; i < name.length; i++) {
        h = (Math.imul(31, h) + name.charCodeAt(i)) | 0;
    }
    return Math.abs(h) || 1;
}

// ---------------------------------------------------------------------------
// 진입점: WA API 초기화 완료 대기
// ---------------------------------------------------------------------------

WA.onInit().then(async () => {
    const playerName = WA.player.name || "anonymous";
    const employeeId = hashName(playerName);

    // -----------------------------------------------------------------------
    // TMJ 로드 → zone_type 조회 (desk / meeting_room / focus_room)
    // -----------------------------------------------------------------------
    let map;
    try {
        map = await WA.room.getTiledMap();
    } catch (e) {
        console.error("[presence.js] getTiledMap 실패:", e);
        map = { layers: [] };
    }

    /**
     * objectName → zone_type 매핑.
     * map_generator.py가 zone 오브젝트에 "zone_type" 프로퍼티를 주입.
     * @type {Map<string, string>}
     */
    const zoneTypeByName = new Map();

    for (const layer of map.layers || []) {
        if (layer.type !== "objectgroup") continue;
        for (const obj of layer.objects || []) {
            const props = obj.properties || [];
            const ztProp = props.find((p) => p.name === "zone_type");
            if (ztProp) {
                zoneTypeByName.set(obj.name, ztProp.value);
            }
        }
    }

    // -----------------------------------------------------------------------
    // 유휴 감지 (D13: 5분 무입력 → AWAY)
    // -----------------------------------------------------------------------
    let lastActivity = Date.now();
    let idleReported = false;

    const bumpActivity = () => {
        lastActivity = Date.now();
        idleReported = false;
    };

    // 브라우저 입력 이벤트로 활동 추적
    if (typeof window !== "undefined") {
        window.addEventListener("keydown", bumpActivity, { passive: true });
        window.addEventListener("mousemove", bumpActivity, { passive: true });
        window.addEventListener("click", bumpActivity, { passive: true });
    }

    setInterval(() => {
        const elapsed = Date.now() - lastActivity;
        if (!idleReported && elapsed >= IDLE_TIMEOUT_MS) {
            idleReported = true;
            postPresence(employeeId, "idle");
        }
    }, IDLE_CHECK_INTERVAL_MS);

    // -----------------------------------------------------------------------
    // 초기 ONLINE 상태 알림
    // -----------------------------------------------------------------------
    await postPresence(employeeId, "connect");

    // -----------------------------------------------------------------------
    // Area 진입/이탈 이벤트 구독
    // WA.room.area.onEnter / onLeave: Tiled 오브젝트(class="area"/type="area") 기반.
    // map_generator.py가 obj_type="area"로 생성한 zone 오브젝트와 매핑.
    // zone_type 프로퍼티를 백엔드 zone_name으로 사용.
    // -----------------------------------------------------------------------
    for (const [zoneName, zoneType] of zoneTypeByName.entries()) {
        WA.room.area.onEnter(zoneName).subscribe(({ reason }) => {
            if (reason === "initial") return; // 구독 시점 이미 존 내 → 무시
            bumpActivity();
            postPresence(employeeId, "enter_zone", { zone_name: zoneType });
        });

        WA.room.area.onLeave(zoneName).subscribe(({ reason }) => {
            if (reason === "initial") return;
            bumpActivity();
            postPresence(employeeId, "leave_zone", { zone_name: zoneType });
        });
    }

    // -----------------------------------------------------------------------
    // Player state 변수 감지 → FOCUS / EXTERNAL (D13)
    // WA.player.state.onVariableChange: 플레이어 커스텀 변수 변경 구독.
    // -----------------------------------------------------------------------
    WA.player.state.onVariableChange("presence_status").subscribe((value) => {
        bumpActivity();
        postPresence(employeeId, "variable", {
            variable_name: "presence_status",
            variable_value: value != null ? String(value) : "",
        });
    });
});
