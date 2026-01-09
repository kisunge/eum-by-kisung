import { useEffect, useMemo, useState } from "react";
import { callApi } from "../api";

type PublicPlayer = { playerId: string; name: string; alive: any; roleRevealed: any };
type ProtectionResult = "none" | "success" | "partial";

type Revealed = {
  killedExists: boolean;
  killedPlayerNames: string[];
  protectionAttempted: boolean;
  protectionResult: ProtectionResult;
};

type PublicGame = {
  status: string;
  endedWinner: string;
  vote1RevealedHunterId: string;
  revealedHunterNames?: string[];
  revealed?: Partial<Revealed>; // ✅ 부분만 올 수도 있으니 Partial로
  players: PublicPlayer[];
};

type Me = {
  playerId: string;
  name: string;
  alive: any;
  roleRevealed: any;
  role: "king" | "hunter" | "animal";
  knownHunter?: null | { playerId: string; name: string };
  otherHunter?: null | { playerId: string; name: string };
};

function isTrue(v: any) {
  return v === true || String(v).toLowerCase() === "true" || String(v) === "1";
}

function phaseLabelPlayer(phase: string) {
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
    case "endedAnimals":
      return "최종결과 확인";
    default:
      return phase;
  }
}

function roleLabel(role: Me["role"]) {
  switch (role) {
    case "king":
      return "동물의 왕";
    case "hunter":
      return "동물의 탈을 쓴 사냥꾼";
    case "animal":
      return "동물친구들";
    default:
      return role;
  }
}

function aliveLabel(phase: string, alive: boolean) {
  const canShow = phase === "hikeEnd" || phase.startsWith("vote") || phase.startsWith("ended");
  if (!canShow) return "알 수 없음";
  return alive ? "생존" : "사망";
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

function phaseSteps() {
  return [
    { key: "hike", label: "등산시작" },
    { key: "vote1", label: "1차투표" },
    { key: "vote2", label: "2차투표" },
    { key: "ended", label: "최종결과" },
  ];
}

function phaseIndex(phase: string) {
  if (phase === "vote1Intro") return 1;
  if (phase === "vote2Intro") return 2;

  if (phase === "hike") return 0;
  if (phase.startsWith("vote1")) return 1;
  if (phase.startsWith("vote2")) return 2;
  if (phase.startsWith("ended")) return 3;

  if (phase === "lobby") return -1;
  if (phase === "hikeEnd") return 0;

  return -1;
}

export default function Player() {
  type UiStage = "splash" | "login" | "game";
  const [uiStage, setUiStage] = useState<UiStage>("splash");

  const [loginId, setLoginId] = useState(localStorage.getItem("loginId") || "");
  const [password, setPassword] = useState("");
  const [token, setToken] = useState(localStorage.getItem("token") || "");

  const [game, setGame] = useState<PublicGame | null>(null);
  const [me, setMe] = useState<Me | null>(null);
  const [msg, setMsg] = useState("");

  const [voteTarget, setVoteTarget] = useState("");
  const [voteReason, setVoteReason] = useState("");

  const phase = game?.status || "lobby";
  const alive = useMemo(() => (me ? isTrue(me.alive) : false), [me]);

  const splashUrl = `${import.meta.env.BASE_URL}ui/splash.png`;

  const START_BTN = {
    left: "23%",
    top: "75%",
    width: "60%",
    height: "20%",
  };

  const myAvatarUrl = useMemo(() => {
    if (!me) return "";
    return `${import.meta.env.BASE_URL}avatars/${me.playerId}.png`;
  }, [me]);

  const myDisplayName = useMemo(() => {
    if (me?.name && me.name.trim()) return me.name;
    if (!me || !game) return "-";
    const p = game.players.find((x) => x.playerId === me.playerId);
    return (p?.name || "-").trim() || "-";
  }, [me, game]);

  async function login() {
    try {
      setMsg("로그인 중...");
      const data = await callApi<{ token: string; me: Me; game: PublicGame }>({
        action: "playerLogin",
        loginId: loginId.trim(),
        password,
      });

      localStorage.setItem("loginId", loginId.trim());
      localStorage.setItem("token", data.token);

      setToken(data.token);
      setMe(data.me);
      setGame(data.game);
      setPassword("");
      setMsg(`접속 완료: ${data.me.name}`);

      setUiStage("game");
    } catch (e: any) {
      console.error(e);
      setMsg(`로그인 실패: ${String(e?.message || e)}`);
      alert(String(e?.message || e));
    }
  }

  async function refresh() {
    if (!token) return;
    const data = await callApi<{ me: Me; game: PublicGame }>({ action: "playerGetMe", token });
    setMe(data.me);
    setGame(data.game);
  }

  useEffect(() => {
    if (!token) return;
    setUiStage("game");
    refresh().catch(() => {});
    const t = setInterval(() => refresh().catch(() => {}), 3000);
    return () => clearInterval(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token]);

  const candidatesVote1 = useMemo(() => {
    if (!game || !me) return [];
    return game.players.filter((p) => isTrue(p.alive) && p.playerId !== me.playerId);
  }, [game, me]);

  const candidatesVote2 = useMemo(() => {
    if (!game || !me) return [];
    const revealedHunterId = (game.vote1RevealedHunterId || "").trim();
    return game.players.filter((p) => {
      if (!isTrue(p.alive)) return false;
      if (p.playerId === me.playerId) return false;
      if (revealedHunterId && p.playerId === revealedHunterId) return false;
      return true;
    });
  }, [game, me]);

  async function submitVote(round: 1 | 2) {
    const t = voteTarget.trim();
    const r = voteReason.trim();
    if (!t) return alert("투표 대상을 선택해 주세요.");
    if (!r) return alert("투표 사유를 입력해 주세요.");

    if (round === 1) {
      await callApi({ action: "playerSubmitVote1", token, targetId: t, reason: r });
    } else {
      await callApi({ action: "playerSubmitVote2", token, targetId: t, reason: r });
    }

    alert(`투표${round} 제출 완료`);
    setVoteTarget("");
    setVoteReason("");
    await refresh();
  }

  // ============================================================
  // SPLASH
  // ============================================================
  if (uiStage === "splash") {
    return (
      <div style={styles.fullBlackCenter}>
        <div style={{ position: "relative", width: "min(980px, 100%)" }}>
          <img src={splashUrl} alt="splash" style={styles.splashImg} />
          <button
            onClick={() => setUiStage("login")}
            aria-label="START"
            style={{
              position: "absolute",
              left: START_BTN.left,
              top: START_BTN.top,
              width: START_BTN.width,
              height: START_BTN.height,
              background: "transparent",
              border: "none",
              cursor: "pointer",
            }}
          />
        </div>
      </div>
    );
  }

  // ============================================================
  // LOGIN POPUP
  // ============================================================
  if (uiStage === "login") {
    return (
      <div style={styles.fullBlackCenter}>
        <div style={{ position: "relative", width: "min(980px, 100%)" }}>
          <img
            src={splashUrl}
            alt="splash"
            style={{
              ...styles.splashImg,
              filter: "blur(3px) brightness(0.85)",
            }}
          />
          <div style={styles.dimOverlay} />

          <div style={styles.loginModal}>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
              <div style={{ fontWeight: 900, fontSize: 18 }}>Login</div>
              <button onClick={() => setUiStage("splash")} aria-label="Close" style={styles.xBtn}>
                ×
              </button>
            </div>

            <div style={{ marginTop: 12 }}>
              <label style={styles.label}>Login ID</label>
              <input
                value={loginId}
                onChange={(e) => setLoginId(e.target.value)}
                placeholder="Enter your ID"
                style={styles.input}
              />
            </div>

            <div style={{ marginTop: 12 }}>
              <label style={styles.label}>Password</label>
              <input
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                type="password"
                placeholder="Enter your password"
                style={styles.input}
              />
            </div>

            <button onClick={login} disabled={!loginId.trim() || !password} style={styles.loginBtn}>
              LOGIN
            </button>

            {msg ? <div style={{ marginTop: 10, fontSize: 13, opacity: 0.92 }}>{msg}</div> : null}
          </div>
        </div>
      </div>
    );
  }

  // ============================================================
  // GAME UI
  // ============================================================

  // ✅ 핵심: revealed가 "있는데 일부 필드가 없는 경우"까지 전부 방어
  const revealedRaw = game?.revealed ?? {};
  const revealed: Revealed = {
    killedExists: !!revealedRaw.killedExists,
    killedPlayerNames: Array.isArray(revealedRaw.killedPlayerNames) ? revealedRaw.killedPlayerNames : [],
    protectionAttempted: !!revealedRaw.protectionAttempted,
    protectionResult:
      revealedRaw.protectionResult === "success" || revealedRaw.protectionResult === "partial" || revealedRaw.protectionResult === "none"
        ? revealedRaw.protectionResult
        : "none",
  };

  const stepIdx = phaseIndex(phase);
  const showVote1 = alive && phase === "vote1";
  const showVote2 = alive && phase === "vote2";
  const showVoteIntro = phase === "vote1Intro" || phase === "vote2Intro";
  const showActionInfo = me?.role === "hunter" || me?.role === "king";

  return (
    <div style={styles.page}>
      <div style={styles.container}>
        <section style={styles.card}>
          <div style={styles.cardTitle}>프로필</div>

          <div style={{ display: "flex", gap: 14, alignItems: "center" }}>
            <div style={styles.avatarWrap}>
              {myAvatarUrl ? (
                <img
                  src={myAvatarUrl}
                  alt="avatar"
                  style={{ width: "100%", height: "100%", imageRendering: "pixelated" as any }}
                />
              ) : (
                <div style={{ color: "#999" }}>-</div>
              )}
            </div>

            <div style={{ flex: 1 }}>
              <div style={{ fontSize: 20, fontWeight: 900, color: "#111" }}>{myDisplayName}</div>

              <div style={{ marginTop: 6, display: "flex", gap: 10, flexWrap: "wrap" }}>
                <Badge label={`역할: ${me ? roleLabel(me.role) : "-"}`} />
                <Badge label={`생존: ${aliveLabel(phase, alive)}`} />
              </div>

              {me?.role === "king" && me.knownHunter ? (
                <div style={{ marginTop: 10, fontSize: 13, color: "#444" }}>
                  내가 아는 사냥꾼 1명: <b>{me.knownHunter.name}</b>
                </div>
              ) : null}
              {me?.role === "hunter" && me.otherHunter ? (
                <div style={{ marginTop: 10, fontSize: 13, color: "#444" }}>
                  다른 사냥꾼: <b>{me.otherHunter.name}</b>
                </div>
              ) : null}
            </div>
          </div>
        </section>

        <section style={styles.card}>
          <div style={styles.cardTitle}>게임 단계</div>

          <div style={{ marginTop: 10 }}>
            <div style={{ fontSize: 14, color: "#555" }}>
              현재 단계: <b style={{ color: "#111" }}>{phaseLabelPlayer(phase)}</b>
              {game?.endedWinner ? <span> / 승자: {game.endedWinner}</span> : null}
            </div>

            <div style={{ marginTop: 12 }}>
              <StepBar currentIndex={stepIdx} />
            </div>
          </div>

          <div style={{ marginTop: 14 }}>
            <details open>
              <summary style={{ cursor: "pointer", fontWeight: 900, color: "#111" }}>규칙 설명</summary>
              <ol style={{ marginTop: 10, lineHeight: 1.7, color: "#333" }}>
                <li>7인의 동물 중 사냥꾼 2명과 동물의 왕 1명이 숨어 있습니다.</li>
                <li>사냥꾼은 등산을 하는 도중 비밀리에 동물을 사냥을 할 수 있습니다.</li>
                <li>동물의 왕은 사냥꾼의 사냥으로부터 동물친구를 보호(본인포함) 할 수 있습니다.</li>
                <li>사냥 방법과 보호 방법은 본인만이 알고 있습니다.</li>
                <li>동물의 왕은 사냥꾼 중 1명이 누구인지 알고 있습니다.</li>
                <li>
                  등산이 끝나고 나면 두 차례의 투표를 통해 사냥꾼을 색출합니다. 이때 이미 사냥을 당해 죽은 동물은 투표에
                  참여할 수 없습니다.
                </li>
                <li>
                  만약 동물들이 사냥꾼 2명 모두를 정확히 밝혀내면 동물들의 승리. 단, 사냥꾼 2명이 모두 들키더라도 마지막에
                  왕의 정체를 맞추는 경우에는 사냥꾼의 최종 승리로 끝.
                </li>
              </ol>
            </details>
          </div>
        </section>

        <section style={styles.card}>
          <div style={styles.cardTitle}>게임 진행 정보</div>

          <div style={{ marginTop: 10, display: "grid", gridTemplateColumns: "1fr", gap: 10 }}>
            <InfoRow
              label="사망자"
              value={
                phase === "hikeEnd" || phase.startsWith("vote") || phase.startsWith("ended")
                  ? revealed.killedPlayerNames.length
                    ? "있음"
                    : "없음"
                  : revealed.killedExists
                  ? "있음"
                  : "없음"
              }
            />
            <InfoRow
              label="사망자 목록"
              value={
                phase === "hikeEnd" || phase.startsWith("vote") || phase.startsWith("ended")
                  ? revealed.killedPlayerNames.join(", ") || "-"
                  : "-"
              }
            />
            <InfoRow label="보호 시도" value={protectionAttemptText(!!revealed.protectionAttempted)} />
            <InfoRow label="보호 성공" value={protectionResultText(!!revealed.protectionAttempted, revealed.protectionResult)} />
          </div>
        </section>

        {showActionInfo && (
          <section style={styles.card}>
            <div style={styles.cardTitle}>행동 정보</div>

            <div style={{ marginTop: 10, color: "#333", lineHeight: 1.7 }}>
              {me?.role === "hunter" ? (
                <>
                  <div style={{ fontWeight: 900, color: "#111" }}>사냥꾼 안내</div>
                  <div style={{ marginTop: 6 }}>
                    등산 중, <b>사냥할 동물의 신발 사진</b>을 찍어서 진행자에게 카톡으로 보내세요.
                  </div>
                  <div style={{ marginBottom: 10 }}>
                    <a href={KAKAO_LINK} target="_blank" rel="noreferrer">
                      <button>진행자 카톡 열기</button>
                    </a>
                  </div>
                </>
              ) : null}

              {me?.role === "king" ? (
                <>
                  <div style={{ fontWeight: 900, color: "#111" }}>동물의 왕 안내</div>
                  <div style={{ marginTop: 6 }}>
                    등산 중, <b>보호할 동물의 손 사진</b>을 찍어서 진행자에게 카톡으로 보내세요. (본인 포함 가능)
                  </div>
                  <div style={{ marginBottom: 10 }}>
                    <a href={KAKAO_LINK} target="_blank" rel="noreferrer">
                      <button>진행자 카톡 열기</button>
                     </a>      
                  </div>
                </>
              ) : null}
            </div>
          </section>
        )}

        <section style={styles.card}>
          <div style={styles.cardTitle}>투표</div>

          <div style={{ marginTop: 10 }}>
            {!alive && (phase === "hikeEnd" || phase.startsWith("vote") || phase.startsWith("ended")) ? (
              <div style={{ color: "#555" }}>사망자는 투표할 수 없어요.</div>
            ) : null}

            {showVoteIntro ? <div style={{ color: "#555" }}>진행자가 투표 설명 중입니다. 잠시만 기다려주세요.</div> : null}

            {showVote1 ? (
              <VoteBox
                title="1차 투표 (사유 필수)"
                candidates={candidatesVote1}
                target={voteTarget}
                reason={voteReason}
                setTarget={setVoteTarget}
                setReason={setVoteReason}
                onSubmit={() => submitVote(1)}
              />
            ) : null}

            {showVote2 ? (
              <VoteBox
                title="2차 투표 (사유 필수)"
                candidates={candidatesVote2}
                target={voteTarget}
                reason={voteReason}
                setTarget={setVoteTarget}
                setReason={setVoteReason}
                onSubmit={() => submitVote(2)}
              />
            ) : null}

            {!showVoteIntro && !showVote1 && !showVote2 ? <div style={{ color: "#555" }}>현재 투표 단계가 아닙니다.</div> : null}
          </div>
        </section>

        <div style={{ display: "flex", gap: 10, justifyContent: "space-between", alignItems: "center" }}>
          <button
            onClick={() => {
              localStorage.removeItem("token");
              setToken("");
              setMe(null);
              setGame(null);
              setMsg("");
              setUiStage("splash");
            }}
            style={styles.secondaryBtn}
          >
            로그아웃
          </button>

          <button onClick={() => refresh().catch(() => {})} style={styles.secondaryBtn}>
            새로고침
          </button>
        </div>

        <div style={{ height: 20 }} />
      </div>
    </div>
  );
}

function Badge(props: { label: string }) {
  return (
    <span
      style={{
        display: "inline-flex",
        alignItems: "center",
        padding: "7px 10px",
        borderRadius: 999,
        border: "1px solid rgba(0,0,0,0.10)",
        background: "rgba(255,255,255,0.75)",
        fontSize: 12,
        fontWeight: 800,
        color: "#222",
      }}
    >
      {props.label}
    </span>
  );
}

function InfoRow(props: { label: string; value: string }) {
  return (
    <div
      style={{
        display: "flex",
        gap: 10,
        alignItems: "center",
        justifyContent: "space-between",
        padding: "10px 12px",
        borderRadius: 12,
        border: "1px solid rgba(0,0,0,0.08)",
        background: "rgba(255,255,255,0.65)",
      }}
    >
      <div style={{ fontWeight: 900, color: "#333" }}>{props.label}</div>
      <div style={{ color: "#111" }}>{props.value}</div>
    </div>
  );
}

function StepBar(props: { currentIndex: number }) {
  const steps = phaseSteps();
  const cur = props.currentIndex;

  return (
    <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
      {steps.map((s, idx) => {
        const active = cur >= idx && cur !== -1;
        const done = cur > idx;

        return (
          <div key={s.key} style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <div
              style={{
                minWidth: 92,
                padding: "10px 12px",
                borderRadius: 14,
                border: "1px solid rgba(0,0,0,0.10)",
                background: active ? "rgba(255,220,120,0.85)" : "rgba(255,255,255,0.60)",
                fontWeight: 900,
                fontSize: 13,
                color: "#222",
                textAlign: "center",
              }}
            >
              {s.label}
              {done ? <span style={{ marginLeft: 6, fontWeight: 900 }}>✓</span> : null}
            </div>

            {idx !== steps.length - 1 ? <div style={{ width: 18, height: 2, background: "rgba(0,0,0,0.18)" }} /> : null}
          </div>
        );
      })}
    </div>
  );
}

function VoteBox(props: {
  title: string;
  candidates: { playerId: string; name: string }[];
  target: string;
  reason: string;
  setTarget: (v: string) => void;
  setReason: (v: string) => void;
  onSubmit: () => Promise<void>;
}) {
  const canSubmit = props.target.trim() && props.reason.trim();
  return (
    <div
      style={{
        border: "1px solid rgba(0,0,0,0.10)",
        padding: 12,
        borderRadius: 12,
        background: "rgba(255,255,255,0.65)",
        color: "#111",
      }}
    >
      <div style={{ marginBottom: 10, fontWeight: 900, color: "#111" }}>{props.title}</div>

      <div style={{ display: "grid", gridTemplateColumns: "1fr", gap: 10 }}>
        <select value={props.target} onChange={(e) => props.setTarget(e.target.value)} style={styles.select}>
          <option value="">대상 선택</option>
          {props.candidates.map((p) => (
            <option key={p.playerId} value={p.playerId}>
              {p.name}
            </option>
          ))}
        </select>

        <textarea
          placeholder="투표 사유(필수)"
          value={props.reason}
          onChange={(e) => props.setReason(e.target.value)}
          rows={4}
          style={styles.textarea}
        />

        <button onClick={props.onSubmit} disabled={!canSubmit} style={{ ...styles.primaryBtn, opacity: canSubmit ? 1 : 0.55 }}>
          제출
        </button>

        {!props.reason.trim() ? <div style={{ fontSize: 12, color: "#666" }}>사유를 입력해야 제출할 수 있어요.</div> : null}
      </div>
    </div>
  );
}

const styles: Record<string, any> = {
  fullBlackCenter: {
    minHeight: "100vh",
    background: "#000",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    padding: 12,
  },
  splashImg: {
    width: "100%",
    height: "auto",
    display: "block",
    borderRadius: 14,
    boxShadow: "0 16px 40px rgba(0,0,0,0.45)",
  },
  dimOverlay: {
    position: "absolute",
    inset: 0,
    borderRadius: 14,
    background: "rgba(0,0,0,0.35)",
  },
  loginModal: {
    position: "absolute",
    left: "50%",
    top: "50%",
    transform: "translate(-50%, -50%)",
    width: "min(420px, 88%)",
    borderRadius: 18,
    background: "rgba(18,18,18,0.92)",
    border: "1px solid rgba(255,255,255,0.18)",
    boxShadow: "0 18px 60px rgba(0,0,0,0.55)",
    padding: 16,
    color: "#fff",
  },
  xBtn: {
    background: "transparent",
    border: "none",
    color: "#fff",
    fontSize: 20,
    cursor: "pointer",
  },
  label: {
    display: "block",
    fontSize: 12,
    color: "rgba(255,255,255,0.8)",
  },
  input: {
    width: "100%",
    marginTop: 6,
    padding: "12px 12px",
    borderRadius: 12,
    border: "1px solid rgba(255,255,255,0.2)",
    background: "rgba(0,0,0,0.25)",
    color: "#fff",
    outline: "none",
  },
  loginBtn: {
    width: "100%",
    marginTop: 14,
    padding: "12px 12px",
    borderRadius: 12,
    border: "1px solid rgba(255,255,255,0.18)",
    background: "rgba(255,200,60,0.95)",
    fontWeight: 900,
    cursor: "pointer",
    color: "#111",
  },

  page: {
    minHeight: "100vh",
    background: "linear-gradient(180deg, rgba(255,245,215,1) 0%, rgba(255,255,255,1) 55%, rgba(245,250,255,1) 100%)",
    padding: "16px 12px",
    color: "#111",
  },
  container: {
    maxWidth: 980,
    margin: "0 auto",
    display: "grid",
    gap: 12,
  },
  card: {
    border: "1px solid rgba(0,0,0,0.10)",
    borderRadius: 16,
    background: "rgba(255,255,255,0.72)",
    boxShadow: "0 10px 26px rgba(0,0,0,0.06)",
    padding: 14,
  },
  cardTitle: {
    fontSize: 16,
    fontWeight: 900,
    color: "#222",
  },
  avatarWrap: {
    width: 88,
    height: 88,
    borderRadius: 18,
    border: "1px solid rgba(0,0,0,0.10)",
    background: "rgba(255,255,255,0.85)",
    overflow: "hidden",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
  },
  primaryBtn: {
    padding: "12px 12px",
    borderRadius: 12,
    border: "1px solid rgba(0,0,0,0.12)",
    background: "rgba(255,200,60,0.95)",
    fontWeight: 900,
    cursor: "pointer",
    color: "#111",
  },
  secondaryBtn: {
    padding: "10px 12px",
    borderRadius: 12,
    border: "1px solid rgba(0,0,0,0.10)",
    background: "rgba(255,255,255,0.85)",
    fontWeight: 900,
    cursor: "pointer",
    color: "#111",
  },
  select: {
    width: "100%",
    padding: "12px 12px",
    borderRadius: 12,
    border: "1px solid rgba(0,0,0,0.12)",
    background: "rgba(255,255,255,0.95)",
    outline: "none",
    fontWeight: 700,
    color: "#111",
  },
  textarea: {
    width: "100%",
    padding: "12px 12px",
    borderRadius: 12,
    border: "1px solid rgba(0,0,0,0.12)",
    background: "rgba(255,255,255,0.95)",
    outline: "none",
    fontWeight: 600,
    color: "#111",
  },
};
