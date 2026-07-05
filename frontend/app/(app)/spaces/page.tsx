"use client";

import { useCallback, useEffect, useState } from "react";
import { ApiError, Floor, Office, Room, SpaceApi } from "@/lib/api";
import { isAdmin, useAuth } from "@/lib/auth";

const ROOM_TYPES = ["meeting", "lobby", "lounge", "focus", "phonebooth"];

export default function SpacesPage() {
  const { user } = useAuth();
  const admin = isAdmin(user?.role);
  const [offices, setOffices] = useState<Office[]>([]);
  const [officeId, setOfficeId] = useState<string | null>(null);
  const [floors, setFloors] = useState<Floor[]>([]);
  const [floorId, setFloorId] = useState<string | null>(null);
  const [rooms, setRooms] = useState<Room[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);

  // 폼
  const [officeName, setOfficeName] = useState("");
  const [floorName, setFloorName] = useState("");
  const [floorLevel, setFloorLevel] = useState(1);
  const [roomName, setRoomName] = useState("");
  const [roomType, setRoomType] = useState("meeting");
  const [roomCap, setRoomCap] = useState(6);

  const notify = useCallback((m: string) => {
    setToast(m);
    window.setTimeout(() => setToast(null), 2500);
  }, []);

  const loadOffices = useCallback(async () => {
    setError(null);
    try {
      const d = await SpaceApi.offices();
      setOffices(d.offices);
      if (d.offices.length && !officeId) setOfficeId(d.offices[0].office_id);
    } catch (err) {
      setError(err instanceof ApiError ? err.detail : "사무실 로딩 실패");
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    loadOffices();
  }, [loadOffices]);

  useEffect(() => {
    if (!officeId) return;
    SpaceApi.floors(officeId).then((d) => {
      setFloors(d.floors);
      setFloorId(d.floors[0]?.floor_id ?? null);
    }).catch(() => setFloors([]));
  }, [officeId]);

  const loadRooms = useCallback(() => {
    if (!floorId) { setRooms([]); return; }
    SpaceApi.rooms(floorId).then((d) => setRooms(d.rooms)).catch(() => setRooms([]));
  }, [floorId]);

  useEffect(() => {
    loadRooms();
  }, [loadRooms]);

  async function addOffice() {
    if (!officeName.trim()) return;
    try { const o = await SpaceApi.createOffice({ name: officeName }); setOfficeName(""); notify("사무실 생성"); await loadOffices(); setOfficeId(o.office_id); }
    catch (e) { notify(e instanceof ApiError ? e.detail : "실패"); }
  }
  async function addFloor() {
    if (!officeId || !floorName.trim()) return;
    try { await SpaceApi.createFloor({ office_id: officeId, level: floorLevel, name: floorName }); setFloorName(""); notify("층 생성"); const d = await SpaceApi.floors(officeId); setFloors(d.floors); }
    catch (e) { notify(e instanceof ApiError ? e.detail : "실패"); }
  }
  async function addRoom() {
    if (!floorId || !roomName.trim()) return;
    try {
      await SpaceApi.createRoom({ floor_id: floorId, type: roomType, name: roomName, capacity: roomCap, coords: { x: 2, y: 2, width: 4, height: 3 } });
      setRoomName(""); notify("회의실 생성"); loadRooms();
    } catch (e) { notify(e instanceof ApiError ? e.detail : "실패"); }
  }

  if (!admin) return <div className="card text-sub">공간 관리는 관리자 권한이 필요합니다. 현재 역할: {user?.role}</div>;

  return (
    <div className="space-y-5">
      <header>
        <h1 className="text-xl font-semibold">공간 관리</h1>
        <p className="mt-1 text-sm text-sub">사무실 · 층 · 회의실(Room) 관리. 좌석 편집은 좌석·배치 편집기에서.</p>
      </header>
      {error && <div className="rounded-md border border-danger/40 bg-danger/10 px-3 py-2 text-sm text-danger">{error}</div>}

      <div className="grid gap-4 lg:grid-cols-3">
        {/* 사무실 */}
        <div className="card space-y-3">
          <h2 className="text-sm font-medium">사무실</h2>
          <div className="space-y-1">
            {offices.map((o) => (
              <button key={o.office_id} onClick={() => setOfficeId(o.office_id)}
                className={`block w-full rounded-md px-3 py-2 text-left text-sm ${officeId === o.office_id ? "bg-brand text-white" : "hover:bg-panel2/40"}`}>
                {o.name}
              </button>
            ))}
            {offices.length === 0 && <p className="text-xs text-sub">사무실이 없습니다.</p>}
          </div>
          <div className="flex gap-2">
            <input className="input" placeholder="새 사무실명" value={officeName} onChange={(e) => setOfficeName(e.target.value)} />
            <button className="btn-ghost" onClick={addOffice}>추가</button>
          </div>
        </div>

        {/* 층 */}
        <div className="card space-y-3">
          <h2 className="text-sm font-medium">층 {officeId ? "" : "(사무실 선택)"}</h2>
          <div className="space-y-1">
            {floors.map((f) => (
              <button key={f.floor_id} onClick={() => setFloorId(f.floor_id)}
                className={`block w-full rounded-md px-3 py-2 text-left text-sm ${floorId === f.floor_id ? "bg-brand text-white" : "hover:bg-panel2/40"}`}>
                {f.level}F · {f.name}
              </button>
            ))}
            {officeId && floors.length === 0 && <p className="text-xs text-sub">층이 없습니다.</p>}
          </div>
          {officeId && (
            <div className="flex gap-2">
              <input className="input w-16" type="number" value={floorLevel} onChange={(e) => setFloorLevel(Number(e.target.value))} />
              <input className="input" placeholder="층 이름" value={floorName} onChange={(e) => setFloorName(e.target.value)} />
              <button className="btn-ghost" onClick={addFloor}>추가</button>
            </div>
          )}
        </div>

        {/* 회의실 */}
        <div className="card space-y-3">
          <h2 className="text-sm font-medium">회의실 {floorId ? "" : "(층 선택)"}</h2>
          <div className="space-y-1">
            {rooms.map((r) => (
              <div key={r.room_id} className="rounded-md bg-bg/60 px-3 py-2 text-sm">
                {r.name} <span className="badge bg-panel2 text-sub">{r.type}</span> <span className="text-xs text-sub">{r.capacity}인</span>
              </div>
            ))}
            {floorId && rooms.length === 0 && <p className="text-xs text-sub">회의실이 없습니다.</p>}
          </div>
          {floorId && (
            <div className="space-y-2">
              <input className="input" placeholder="회의실명" value={roomName} onChange={(e) => setRoomName(e.target.value)} />
              <div className="flex gap-2">
                <select className="input" value={roomType} onChange={(e) => setRoomType(e.target.value)}>
                  {ROOM_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
                </select>
                <input className="input w-20" type="number" value={roomCap} onChange={(e) => setRoomCap(Number(e.target.value))} />
                <button className="btn-ghost" onClick={addRoom}>추가</button>
              </div>
            </div>
          )}
        </div>
      </div>

      {toast && <div className="fixed bottom-6 right-6 z-50 rounded-md bg-panel2 px-4 py-2 text-sm shadow-lg">{toast}</div>}
    </div>
  );
}
