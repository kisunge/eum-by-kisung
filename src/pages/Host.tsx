import { useEffect, useMemo, useState } from "react";
import { callApi } from "../api";

type PublicPlayer = { playerId: string; name: string; alive: any; roleRevealed: any; role?: string };
type ProtectionResult = "none" | "success" | "partial";

type PublicGame = {
  status: string;
  endedWinner: string;
  vote1RevealedHunterId: string;
  revealedHunterNames?: string[];
  revealed: {
    killedExists: boolean;
    killedPlayerIds: string[];
    protectionAttempted: boolean;
    protectionResult: ProtectionResult;
  };
  players: PublicPlayer[]; // hostGetGame에서 role 포함되어 내려온다고 가정
};

type ActionRow = {
  playerId: string;
  playerName: string;
  role: string;
  huntTargetName: string;
  protectTargetName: string;
};

type VoteRow = {
  voterId: string;
  voterName: string;
  targetId: string;
  targetName: string;
  reason: string;
};

const KAKAO_LINK = "http://qr.kakao.com/talk/uP76SnGIaCCpwgnfKQu0LTjQsvQ-";

function phaseLabelHost(phase: string) {
  switch (phase) {
    case "lobby":
      return "대기";
    case "hike":
      return "등산시작";
    case "hikeEnd":
      return "등산종료";
    case "vote1Intro":
      return "1차투표(설명)";
    case "vote1":
      return "1차투표(진행)";
    case "vote2Intro":
      return "2차투표(설명)";
    case "vote2":
      return "2차투표(진행)";
    case "endedHunters":
      return "종료(사냥꾼 승)";
    case "endedAnimals":
      return "종료(동물 승)";
    default:
      return phase;
  }
}

function isTrue(v: any) {
  return v === true || String(v).toLowerCase() === "true" || String(v) === "1";
}

function protectionAttemptText(attempted: boolean) {
  return attempted ? "시도함" : "시도 안함";
}

function protectionResultText(attempted: boolean, result: ProtectionResult) {
  if (!attempted) return "해당 없음";
  if (result === "success") return "성공";
  if (result === "partial") return "일부 성공";
  return "실패";
}

export default function Host() {
  const [hostPin, setHostPin] = useState(localStorage.getItem("hostPin") || "1234");
  const [game, setGame] = useState<PublicGame | null>(null);
  const [msg, setMsg] = useState("");

  const [actions, setActions] = useState<ActionRow[]>([]);
  const [vote1, setVote1] = useState<VoteRow[]>([]);
  const [vote2, setVote2] = useState<VoteRow[]>([]);
  const [vote1Counts, setVote1Counts] = useState<Record<string, number>>({});
  const [vote2Counts, setVote2Counts] = useState<Record<string, number>>({});
  const [vote1Missing, setVote1Missing] = useState<string[]>([]);
  const [vote2Missing, setVote2Missing] = useState<string[]>([]);

  // ✅ 진행자가 직접 입력하는 사냥/보호 상태
  const [huntHunterId, setHuntHunterId] = useState("");
  const [huntTargetId, setHuntTargetId] = useState("");
  const [protectTargetId, setProtectTargetId] = useState("");

  const phase = game?.status || "lobby";

  const nameById = useMemo(() => {
    const m: Record<string, string> = {};
    (game?.players || []).forEach((p) => (m[p.playerId] = p.name));
    return m;
  }, [game]);

  // ✅ role 포함 데이터가 내려온다고 했으니, 여기서 왕/사냥꾼/대상 후보 구성
  const king = useMemo(() => {
    const ps = game?.players || [];
    return ps.find((p) => String(p.role) === "king") || null;
  }, [game]);

  const hunters = useMemo(() => {
    const ps = game?.players || [];
    return ps.filter((p) => String(p.role) === "hunter" && isTrue(p.alive));
  }, [game]);

  // 사냥 대상: 살아있는 사람 중 사냥꾼 제외(왕 포함)
  const huntCandidates = useMemo(() => {
    const ps = game?.players || [];
    return ps.filter((p) => isTrue(p.alive) && String(p.role) !== "hunter");
  }, [game]);

  // 보호 대상: 살아있는 전체(왕 자기 포함 가능)
  const protectCandidates = useMemo(() => {
    const ps = game?.players || [];
    return ps.filter((p) => isTrue(p.alive));
  }, [game]);

  async function loadGame() {
    const data = await callApi<{ game: PublicGame }>({ action: "hostGetGame", hostPin: hostPin.trim() });
    setGame(data.game);
  }

  useEffect(() => {
    loadGame().catch(() => {});
    const t = setInterval(() => loadGame().catch(() => {}), 3000);
    return () => clearInterval(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hostPin]);

  async function setStatus(status: string) {
    await callApi({ action: "hostSetStatus", hostPin: hostPin.trim(), status });
    setMsg(`단계 변경: ${status}`);
    await loadGame();
  }

  async function loadActions() {
    const data = await callApi<{ actions: any[] }>({ action: "hostGetActions", hostPin: hostPin.trim() });
    setActions(
      (data.actions || []).map((r) => ({
        playerId: r.playerId,
        playerName: r.playerName,
        role: r.role,
        huntTargetName: r.huntTargetName,
        protectTargetName: r.protectTargetName,
      }))
    );
    setMsg("사냥/보호 대상 조회 완료");
  }

  async function loadVotes() {
    const data = await callApi<{
      vote1Missing: string[];
      vote2Missing: string[];
      vote1: VoteRow[];
      vote2: VoteRow[];
      vote1Counts: Record<string, number>;
      vote2Counts: Record<string, number>;
      vote1RevealedHunterId: string;
    }>({ action: "hostGetVotes", hostPin: hostPin.trim() });

    setVote1Missing(data.vote1Missing || []);
    setVote2Missing(data.vote2Missing || []);
    setVote1(data.vote1 || []);
    setVote2(data.vote2 || []);
    setVote1Counts(data.vote1Counts || {});
    setVote2Counts(data.vote2Counts || {});
    setMsg("투표 현황 조회 완료");
    await loadGame();
  }

  async function finalizeVote1() {
    const res = await callApi<{ result: string; revealedHunters: string[] }>({
      action: "hostFinalizeVote1",
      hostPin: hostPin.trim(),
    });
    setMsg(`1차 투표 완료처리 결과: ${res.result}`);
    await loadGame();
    await loadVotes();
  }

  async function finalizeVote2() {
    const res = await callApi<{ result: string; revealedHunters: string[] }>({
      action: "hostFinalizeVote2",
      hostPin: hostPin.trim(),
    });
    setMsg(`2차 투표 완료처리 결과: ${res.result}`);
    await loadGame();
    await loadVotes();
  }

  async function revealAfterHikeEnd() {
    const data = await callApi<{
      revealed: { killedPlayerIds: string[]; protectionAttempted: boolean; protectionResult: ProtectionResult };
    }>({
      action: "hostReveal",
      hostPin: hostPin.trim(),
    });

    setMsg(
      `공개 완료: 사망자 ${data.revealed.killedPlayerIds?.length || 0}명 / 보호 ${protectionAttemptText(
        data.revealed.protectionAttempted
      )} / 결과 ${protectionResultText(data.revealed.protectionAttempted, data.revealed.protectionResult)}`
    );

    await loadGame();
  }

  async function resetLobby() {
    await callApi({ action: "hostResetLobby", hostPin: hostPin.trim() });
    setMsg("로비로 초기화 완료");
    setActions([]);
    setVote1([]);
    setVote2([]);
    setVote1Counts({});
    setVote2Counts({});
    setVote1Missing([]);
    setVote2Missing([]);
    setHuntHunterId("");
    setHuntTargetId("");
    setProtectTargetId("");
    await loadGame();
  }

  // ✅ NEW: 진행자가 직접 사냥/보호 기록하는 API 호출
  async function hostSetHunt() {
    const h = huntHunterId.trim();
    const t = huntTargetId.trim();
    if (!h || !t) return alert("사냥꾼/대상을 선택하세요.");

    await callApi({ action: "hostSetHunt", hostPin: hostPin.trim(), hunterId: h, targetId: t });
    alert("사냥 기록 저장 완료");
    setMsg(`사냥 기록 저장: ${nameById[h] || h} → ${nameById[t] || t}`);

    // 입력값 리셋(선택)
    setHuntTargetId("");

    // 조회 갱신
    await loadActions();
    await loadGame();
  }

  async function hostSetProtect() {
    const k = king?.playerId || "";
    const t = protectTargetId.trim();
    if (!k) return alert("왕 정보가 없습니다.");
    if (!t) return alert("보호 대상을 선택하세요.");

    await callApi({ action: "hostSetProtect", hostPin: hostPin.trim(), kingId: k, targetId: t });
    alert("보호 기록 저장 완료");
    setMsg(`보호 기록 저장: ${nameById[k] || k} → ${nameById[t] || t}`);

    // 입력값 리셋(선택)
    setProtectTargetId("");

    await loadActions();
    await loadGame();
  }

  return (
    <div style={{ padding: 16, maxWidth: 1100 }}>
      <h1>호스트</h1>

      <section style={{ border: "1px solid #ddd", padding: 12, marginBottom: 12 }}>
        <h2>호스트 PIN</h2>
        <input value={hostPin} onChange={(e) => setHostPin(e.target.value)} style={{ width: 140 }} />
        <button
          onClick={() => {
            localStorage.setItem("hostPin", hostPin);
            setMsg("PIN 저장됨");
          }}
          style={{ marginLeft: 8 }}
        >
          저장
        </button>
        <div style={{ marginTop: 8, color: "#555" }}>{msg}</div>
      </section>

      <section style={{ border: "1px solid #ddd", padding: 12, marginBottom: 12 }}>
        <h2>현재 단계</h2>
        <div>
          단계: <b>{phaseLabelHost(phase)}</b>
        </div>
        {game?.revealedHunterNames?.length ? (
          <div style={{ marginTop: 8 }}>
            발각된 사냥꾼(공개됨): <b>{game.revealedHunterNames.join(", ")}</b>
          </div>
        ) : null}
      </section>

      <section style={{ border: "1px solid #ddd", padding: 12, marginBottom: 12 }}>
        <h2>진행 버튼</h2>

        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          <button onClick={() => setStatus("lobby")}>대기</button>
          <button onClick={() => setStatus("hike")}>등산시작</button>
          <button onClick={() => setStatus("hikeEnd")}>등산종료</button>
          <button onClick={revealAfterHikeEnd}>공개(사망/보호 확정)</button>
        </div>

        <hr style={{ margin: "12px 0" }} />

        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          <button onClick={() => setStatus("vote1Intro")}>1차투표 개시(설명)</button>
          <button onClick={() => setStatus("vote1")}>1차투표 열기(플레이어 투표)</button>
          <button onClick={loadVotes}>투표현황 조회</button>
          <button onClick={finalizeVote1}>1차투표 수동 완료처리</button>
        </div>

        <div style={{ marginTop: 10, fontSize: 13, color: "#555", lineHeight: 1.5 }}>
          <div>
            1차 완료처리 규칙:
            <ul>
              <li>사냥꾼 1명만 2표 이상 → 발각 공개 → 2차투표(설명)로 이동</li>
              <li>사냥꾼 2명 모두 2표 이상 → 둘 공개 → 동물 승리 화면</li>
              <li>0명 발각 → 사냥꾼 승리 화면</li>
            </ul>
          </div>
        </div>

        <hr style={{ margin: "12px 0" }} />

        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          <button onClick={() => setStatus("vote2")}>2차투표 열기(플레이어 투표)</button>
          <button onClick={loadVotes}>투표현황 조회</button>
          <button onClick={finalizeVote2}>2차투표 수동 완료처리</button>
        </div>

        <div style={{ marginTop: 10, fontSize: 13, color: "#555", lineHeight: 1.5 }}>
          <div>
            2차 완료처리 규칙:
            <ul>
              <li>남은 사냥꾼 3표 이상 → 발각 공개 → 동물 승리 화면</li>
              <li>발각 실패 → 사냥꾼 승리 화면</li>
            </ul>
          </div>
        </div>

        <div style={{ marginTop: 12 }}>
          <button onClick={resetLobby}>로비로 초기화</button>
        </div>
      </section>

      {/* ✅ NEW 섹션: 등산시작 단계에서 진행자가 직접 사냥/보호 기록 */}
      <section style={{ border: "1px solid #ddd", padding: 12, marginBottom: 12 }}>
        <h2>진행자 카톡 확인 후 사냥/보호 기록</h2>

        <div style={{ marginBottom: 10 }}>
          <a href={KAKAO_LINK} target="_blank" rel="noreferrer">
            <button>진행자 카카오톡 열기</button>
          </a>
          <span style={{ marginLeft: 10, fontSize: 12, color: "#666" }}>
            (플레이어가 사진을 보내면 여기서 직접 기록)
          </span>
        </div>

        {phase !== "hike" ? (
          <div style={{ color: "#777" }}>등산시작 단계에서만 기록할 수 있어요.</div>
        ) : (
          <div style={{ display: "flex", gap: 16, flexWrap: "wrap" }}>
            <div style={{ border: "1px solid #eee", padding: 12, minWidth: 340 }}>
              <div style={{ marginBottom: 8 }}>
                <b>사냥 기록</b>
              </div>

              <div style={{ marginBottom: 8 }}>
                <div style={{ fontSize: 12, color: "#666" }}>사냥꾼 선택</div>
                <select value={huntHunterId} onChange={(e) => setHuntHunterId(e.target.value)} style={{ width: "100%" }}>
                  <option value="">선택</option>
                  {hunters.map((h) => (
                    <option key={h.playerId} value={h.playerId}>
                      {h.name}
                    </option>
                  ))}
                </select>
              </div>

              <div style={{ marginBottom: 8 }}>
                <div style={{ fontSize: 12, color: "#666" }}>사냥 대상(사냥꾼 제외, 왕 포함 가능)</div>
                <select value={huntTargetId} onChange={(e) => setHuntTargetId(e.target.value)} style={{ width: "100%" }}>
                  <option value="">선택</option>
                  {huntCandidates
                    .filter((p) => p.playerId !== huntHunterId) // 혹시 같은 id 선택 방지(추가 안전)
                    .map((p) => (
                      <option key={p.playerId} value={p.playerId}>
                        {p.name}
                      </option>
                    ))}
                </select>
              </div>

              <button onClick={hostSetHunt} disabled={!huntHunterId || !huntTargetId}>
                사냥 기록 저장
              </button>

              <div style={{ marginTop: 8, fontSize: 12, color: "#666", lineHeight: 1.5 }}>
                * 플레이어는 선택/제출을 하지 않습니다. 카톡 사진 확인 후 진행자가 입력합니다.
              </div>
            </div>

            <div style={{ border: "1px solid #eee", padding: 12, minWidth: 340 }}>
              <div style={{ marginBottom: 8 }}>
                <b>보호 기록</b>
              </div>

              <div style={{ marginBottom: 8, fontSize: 12, color: "#666" }}>
                왕: <b>{king ? king.name : "없음"}</b>
              </div>

              <div style={{ marginBottom: 8 }}>
                <div style={{ fontSize: 12, color: "#666" }}>보호 대상(자기 포함 가능)</div>
                <select
                  value={protectTargetId}
                  onChange={(e) => setProtectTargetId(e.target.value)}
                  style={{ width: "100%" }}
                >
                  <option value="">선택</option>
                  {protectCandidates.map((p) => (
                    <option key={p.playerId} value={p.playerId}>
                      {p.name}
                    </option>
                  ))}
                </select>
              </div>

              <button onClick={hostSetProtect} disabled={!king || !protectTargetId}>
                보호 기록 저장
              </button>

              <div style={{ marginTop: 8, fontSize: 12, color: "#666", lineHeight: 1.5 }}>
                * 왕 본인도 보호 가능(사냥꾼이 왕을 사냥할 수 있으므로)
              </div>
            </div>
          </div>
        )}
      </section>

      <section style={{ border: "1px solid #ddd", padding: 12, marginBottom: 12 }}>
        <h2>사냥/보호 대상 확인(호스트 전용)</h2>
        <button onClick={loadActions}>조회</button>

        <div style={{ marginTop: 10 }}>
          {actions.length === 0 ? (
            <div style={{ color: "#777" }}>조회된 데이터가 없습니다.</div>
          ) : (
            <table style={{ borderCollapse: "collapse", width: "100%" }}>
              <thead>
                <tr>
                  <th style={{ border: "1px solid #ddd", padding: 8 }}>플레이어</th>
                  <th style={{ border: "1px solid #ddd", padding: 8 }}>역할(호스트용)</th>
                  <th style={{ border: "1px solid #ddd", padding: 8 }}>사냥 대상</th>
                  <th style={{ border: "1px solid #ddd", padding: 8 }}>보호 대상</th>
                </tr>
              </thead>
              <tbody>
                {actions.map((r) => (
                  <tr key={r.playerId}>
                    <td style={{ border: "1px solid #ddd", padding: 8 }}>{r.playerName}</td>
                    <td style={{ border: "1px solid #ddd", padding: 8 }}>{r.role}</td>
                    <td style={{ border: "1px solid #ddd", padding: 8 }}>{r.huntTargetName || "-"}</td>
                    <td style={{ border: "1px solid #ddd", padding: 8 }}>{r.protectTargetName || "-"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </section>

      <section style={{ border: "1px solid #ddd", padding: 12, marginBottom: 12 }}>
        <h2>투표 상세(누가 누구/사유)</h2>

        <div style={{ marginTop: 10 }}>
          <h3>1차 투표</h3>
          <div style={{ color: "#555" }}>
            미투표자: {(vote1Missing || []).map((id) => nameById[id] || id).join(", ") || "없음"}
          </div>
          <div style={{ marginTop: 8 }}>
            <b>득표</b>:{" "}
            {Object.keys(vote1Counts).length
              ? Object.entries(vote1Counts)
                  .map(([id, c]) => `${nameById[id] || id}: ${c}`)
                  .join(" / ")
              : "없음"}
          </div>
          <ul>
            {vote1.map((v) => (
              <li key={v.voterId}>
                {v.voterName} → {v.targetName || "-"} / 사유: {v.reason || "-"}
              </li>
            ))}
          </ul>
        </div>

        <hr />

        <div style={{ marginTop: 10 }}>
          <h3>2차 투표</h3>
          <div style={{ color: "#555" }}>
            미투표자: {(vote2Missing || []).map((id) => nameById[id] || id).join(", ") || "없음"}
          </div>
          <div style={{ marginTop: 8 }}>
            <b>득표</b>:{" "}
            {Object.keys(vote2Counts).length
              ? Object.entries(vote2Counts)
                  .map(([id, c]) => `${nameById[id] || id}: ${c}`)
                  .join(" / ")
              : "없음"}
          </div>
          <ul>
            {vote2.map((v) => (
              <li key={v.voterId}>
                {v.voterName} → {v.targetName || "-"} / 사유: {v.reason || "-"}
              </li>
            ))}
          </ul>
        </div>
      </section>
    </div>
  );
}
