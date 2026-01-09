import { useEffect, useMemo, useRef, useState } from "react";
import { callApi } from "../api";

type PublicPlayer = { playerId: string; name: string; alive: any; roleRevealed: any };
type ProtectionResult = "none" | "success" | "partial";

type VoteSummaryRow = {
  targetId: string;
  targetName: string;
  count: number;
  reasons: string[];
};

type VoteResultBlock = {
  rows: VoteSummaryRow[];
  outcome: string; // vote1: success_one|success_both|fail, vote2: success|fail
  revealedHunters: string[];
};

type PublicGame = {
  status: string;
  endedWinner: string;
  vote1RevealedHunterId: string;
  revealed: {
    killedExists: boolean;
    killedPlayerNames?: string[];
    killedPlayerIds?: string[];
    protectionAttempted: boolean;
    protectionResult: ProtectionResult;
  };
  players: PublicPlayer[];

  voteResults?: {
    vote1?: VoteResultBlock;
    vote2?: VoteResultBlock;
  };

  // 레거시(남아있을 수 있어 방어적으로 유지)
  vote1Result?: any;
  vote2Result?: any;
};

type Me = {
  playerId: string;
  name: string;
  alive: any;
  roleRevealed: any;
  role: any;
  knownHunter?: null | { playerId: string; name: string };
  otherHunter?: null | { playerId: string; name: string };
};

function isTrue(v: any) {
  return v === true || String(v).toLowerCase() === "true" || String(v) === "1";
}

function phaseLabelPlayer(phaseKey: string) {
  switch (phaseKey) {
    case "lobby":
      return "대기";
    case "hike":
      return "등산시작";
    case "hikeend":
      return "등산종료";
    case "vote1intro":
      return "1차투표(설명)";
    case "vote1":
      return "1차투표(진행)";
    case "vote2intro":
      return "2차투표(설명)";
    case "vote2":
      return "2차투표(진행)";
    case "endedhunters":
    case "endedanimals":
      return "최종결과 확인";
    default:
      return phaseKey;
  }
}

function roleLabel(roleKey: string) {
  switch (roleKey) {
    case "king":
      return "동물의 왕";
    case "hunter":
      return "동물의 탈을 쓴 사냥꾼";
    case "animal":
      return "동물친구들";
    default:
      return roleKey || "-";
  }
}

function aliveLabel(phaseKey: string, alive: boolean) {
  const canShow = phaseKey === "hikeend" || phaseKey.startsWith("vote") || phaseKey.startsWith("ended");
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

function phaseIndex(phaseKey: string) {
  if (phaseKey === "vote1intro") return 1;
  if (phaseKey === "vote2intro") return 2;

  if (phaseKey === "hike") return 0;
  if (phaseKey.startsWith("vote1")) return 1;
  if (phaseKey.startsWith("vote2")) return 2;
  if (phaseKey.startsWith("ended")) return 3;

  if (phaseKey === "lobby") return -1;
  if (phaseKey === "hikeend") return 0;

  return -1;
}

function isInvalidTokenError(e: any) {
  const m = String(e?.message || e || "").toLowerCase();
  return m.includes("invalid token") || m.includes("token required") || m.includes("unauthorized");
}

function normalizeVoteBlock(input: any): VoteResultBlock | null {
  try {
    if (!input) return null;

    if (typeof input === "object" && input.rows && Array.isArray(input.rows)) {
      return {
        rows: input.rows || [],
        outcome: String(input.outcome || ""),
        revealedHunters: Array.isArray(input.revealedHunters) ? input.revealedHunters : [],
      };
    }

    if (Array.isArray(input)) {
      return { rows: input, outcome: "", revealedHunters: [] };
    }

    if (typeof input === "string") {
      const s = input.trim();
      if (!s) return null;
      return normalizeVoteBlock(JSON.parse(s));
    }

    return null;
  } catch {
    return null;
  }
}

export default function Player() {
  type UiStage = "splash" | "login" | "game";
  const [uiStage, setUiStage] = useState<UiStage>("splash");

  const [loginId, setLoginId] = useState(localStorage.getItem("loginId") || "");
  const [password, setPassword] = useState("");
  const [token, setToken] = useState(localStorage.getItem("token") || "");

  const [game, setGame] = useState<PublicGame | null>(null);
  const [me, setMe] = useState<Me | null>(null);

  const [netState, setNetState] = useState<{ ok: boolean; msg: string }>({ ok: true, msg: "" });
  const refreshingRef = useRef(false);
  const timerRef = useRef<number | null>(null);

  const [voteTarget, setVoteTarget] = useState("");
  const [voteReason, setVoteReason] = useState("");

  const splashUrl = `${import.meta.env.BASE_URL}ui/splash.png`;

  const START_BTN = {
    left: "23%",
    top: "75%",
    width: "60%",
    height: "20%",
  };

  const KAKAO_URL = "http://qr.kakao.com/talk/uP76SnGIaCCpwgnfKQu0LTjQsvQ-";

  // ✅ 결과 이미지(public/ui/)
  const hunterWinImg = `${import.meta.env.BASE_URL}ui/result_hunter_win.png`;
  const animalWinImg = `${import.meta.env.BASE_URL}ui/result_animal_win.png`;

  // ===========================
  // ✅ 모든 useMemo는 early return 이전에!
  // ===========================
  const phaseKey = useMemo(() => String(game?.status ?? "lobby").trim().toLowerCase(), [game?.status]);
  const roleKey = useMemo(() => String(me?.role ?? "").trim().toLowerCase(), [me?.role]);
  const alive = useMemo(() => (me ? isTrue(me.alive) : false), [me]);

  const myAvatarUrl = useMemo(() => {
    if (!me) return "";
    return `${import.meta.env.BASE_URL}avatars/${me.playerId}.png`;
  }, [me]);

  const myDisplayName = useMemo(() => {
    if (me?.name && String(me.name).trim()) return String(me.name).trim();
    if (!me || !game) return "-";
    const p = (game.players || []).find((x) => x.playerId === me.playerId);
    return (p?.name || "-").trim() || "-";
  }, [me, game]);

  const candidatesVote1 = useMemo(() => {
    if (!game || !me) return [];
    return (game.players || []).filter((p) => isTrue(p.alive) && p.playerId !== me.playerId);
  }, [game, me]);

  const candidatesVote2 = useMemo(() => {
    if (!game || !me) return [];
    const revealed = String(game.vote1RevealedHunterId || "").trim();
    return (game.players || []).filter((p) => {
      if (!isTrue(p.alive)) return false;
      if (p.playerId === me.playerId) return false;
      if (revealed && p.playerId === revealed) return false;
      return true;
    });
  }, [game, me]);

  const vote1Block = useMemo(() => {
    const v = game?.voteResults?.vote1;
    if (v && (v.outcome || (v.rows && v.rows.length))) return v;
    return normalizeVoteBlock(game?.vote1Result);
  }, [game]);

  const vote2Block = useMemo(() => {
    const v = game?.voteResults?.vote2;
    if (v && (v.outcome || (v.rows && v.rows.length))) return v;
    return normalizeVoteBlock(game?.vote2Result);
  }, [game]);

  const showVote1ResultBox = useMemo(() => !!(vote1Block && (vote1Block.outcome || vote1Block.rows.length)), [vote1Block]);
  const showVote2ResultBox = useMemo(() => !!(vote2Block && (vote2Block.outcome || vote2Block.rows.length)), [vote2Block]);

  const bothHuntersCaughtOnVote2 = useMemo(() => {
    if (!vote2Block) return false;
    if (String(vote2Block.outcome || "").toLowerCase() !== "success") return false;
    const v1 = vote1Block?.revealedHunters || [];
    const v2 = vote2Block?.revealedHunters || [];
    const all = Array.from(new Set([...v1, ...v2].filter(Boolean)));
    return all.length >= 2;
  }, [vote1Block, vote2Block]);

  const hunterProfileUrl = (pid: string) => `${import.meta.env.BASE_URL}avartars/${String(pid).toLowerCase()}_hunter.png`;
  const playerNameById = (pid: string) => (game?.players || []).find((p) => p.playerId === pid)?.name || pid;

  const doLogout = (msg?: string) => {
    localStorage.removeItem("token");
    setToken("");
    setMe(null);
    setGame(null);
    setPassword("");
    setNetState(msg ? { ok: false, msg } : { ok: true, msg: "" });
    setUiStage("splash");
  };

  async function login() {
    try {
      setNetState({ ok: true, msg: "" });
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
      setUiStage("game");
    } catch (e: any) {
      console.error(e);
      const m = String(e?.message || e);
      setNetState({ ok: false, msg: `로그인 실패: ${m}` });
      alert(m);
    }
  }

  async function refreshOnce() {
    if (!token) return;
    if (refreshingRef.current) return;
    refreshingRef.current = true;

    try {
      const data = await callApi<{ me: Me; game: PublicGame }>({ action: "playerGetMe", token });
      setMe(data.me);
      setGame(data.game);
      setNetState({ ok: true, msg: "" });
    } catch (e: any) {
      console.error(e);
      if (isInvalidTokenError(e)) {
        doLogout("세션이 만료되었어요. 다시 로그인해 주세요.");
        return;
      }
      setNetState({
        ok: false,
        msg: "네트워크 연결이 일시 중단되었어요. 화면을 다시 켜거나, 아래 [새로고침]을 눌러 주세요.",
      });
    } finally {
      refreshingRef.current = false;
    }
  }

  // polling
  useEffect(() => {
    if (!token) return;

    setUiStage("game");
    refreshOnce().catch(() => {});

    const clear = () => {
      if (timerRef.current) {
        window.clearTimeout(timerRef.current);
        timerRef.current = null;
      }
    };

    const loop = async () => {
      clear();
      if (document.visibilityState !== "visible") return;
      await refreshOnce();
      timerRef.current = window.setTimeout(loop, 5000);
    };

    const onVis = () => {
      if (document.visibilityState === "visible") {
        refreshOnce().finally(() => loop());
      } else {
        clear();
      }
    };

    const onFocus = () => refreshOnce().finally(() => loop());
    const onOnline = () => {
      setNetState({ ok: true, msg: "" });
      refreshOnce().finally(() => loop());
    };

    document.addEventListener("visibilitychange", onVis);
    window.addEventListener("focus", onFocus);
    window.addEventListener("online", onOnline);

    loop();

    return () => {
      clear();
      document.removeEventListener("visibilitychange", onVis);
      window.removeEventListener("focus", onFocus);
      window.removeEventListener("online", onOnline);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token]);

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
    await refreshOnce();
  }

  // ============================================================
  // ✅ 이제부터 early return (훅 없음)
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
              <input value={loginId} onChange={(e) => setLoginId(e.target.value)} placeholder="Enter your ID" style={styles.input} />
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

            {!netState.ok ? <div style={{ marginTop: 10, fontSize: 13, opacity: 0.92 }}>{netState.msg}</div> : null}
          </div>
        </div>
      </div>
    );
  }

  // ============================================================
  // GAME UI
  // ============================================================
  const stepIdx = phaseIndex(phaseKey);

  const showVote1 = alive && phaseKey === "vote1";
  const showVote2 = alive && phaseKey === "vote2";
  const showVoteIntro = phaseKey === "vote1intro" || phaseKey === "vote2intro";

  const isHunterOrKing = roleKey === "hunter" || roleKey === "king";
  const showActionInfo = phaseKey === "hike" && isHunterOrKing;

  return (
    <div style={styles.page}>
      <div style={styles.container}>
        {!netState.ok ? (
          <div
            style={{
              border: "1px solid rgba(0,0,0,0.15)",
              borderRadius: 14,
              padding: 12,
              background: "rgba(255,255,255,0.85)",
              color: "#111",
              fontWeight: 800,
            }}
          >
            {netState.msg}
          </div>
        ) : null}

        {!me || !game ? (
          <div style={{ color: "#111", fontWeight: 900 }}>게임 정보를 불러오는 중...</div>
        ) : (
          <>
            {/* 프로필 */}
            <section style={styles.card}>
              <div style={styles.cardTitle}>프로필</div>

              <div style={{ display: "flex", gap: 14, alignItems: "center" }}>
                <div style={styles.avatarWrap}>
                  {myAvatarUrl ? (
                    <img src={myAvatarUrl} alt="avatar" style={{ width: "100%", height: "100%", imageRendering: "pixelated" as any }} />
                  ) : (
                    <div style={{ color: "#999" }}>-</div>
                  )}
                </div>

                <div style={{ flex: 1 }}>
                  <div style={{ fontSize: 20, fontWeight: 900, color: "#111" }}>{myDisplayName}</div>
                  <div style={{ marginTop: 6, display: "flex", gap: 10, flexWrap: "wrap" }}>
                    <Badge label={`역할: ${roleLabel(roleKey)}`} />
                    <Badge label={`생존: ${aliveLabel(phaseKey, alive)}`} />
                  </div>

                  {roleKey === "king" && me.knownHunter ? (
                    <div style={{ marginTop: 10, fontSize: 13, color: "#444" }}>
                      내가 아는 사냥꾼 1명: <b>{me.knownHunter.name}</b>
                    </div>
                  ) : null}
                  {roleKey === "hunter" && me.otherHunter ? (
                    <div style={{ marginTop: 10, fontSize: 13, color: "#444" }}>
                      다른 사냥꾼: <b>{me.otherHunter.name}</b>
                    </div>
                  ) : null}
                </div>
              </div>
            </section>

            {/* 게임 단계 */}
            <section style={styles.card}>
              <div style={styles.cardTitle}>게임 단계</div>

              <div style={{ marginTop: 10, fontSize: 14, color: "#555" }}>
                현재 단계: <b style={{ color: "#111" }}>{phaseLabelPlayer(phaseKey)}</b>
                {game.endedWinner ? <span> / 승자: {game.endedWinner}</span> : null}
              </div>

              <div style={{ marginTop: 12 }}>
                <StepBar currentIndex={stepIdx} />
              </div>
            </section>

            {/* 진행 정보 */}
            <section style={styles.card}>
              <div style={styles.cardTitle}>게임 진행 정보</div>

              {(() => {
                const killedNames = (game.revealed.killedPlayerNames || []).filter(Boolean);
                const killedIds = (game.revealed.killedPlayerIds || []).filter(Boolean);
                const idToName = (id: string) => (game.players || []).find((p) => p.playerId === id)?.name || id;
                const killedList = killedNames.length ? killedNames : killedIds.map(idToName);

                const showPublic = phaseKey === "hikeend" || phaseKey.startsWith("vote") || phaseKey.startsWith("ended");
                const killedExists = showPublic ? killedList.length > 0 : !!game.revealed.killedExists;

                return (
                  <div style={{ marginTop: 10, display: "grid", gridTemplateColumns: "1fr", gap: 10 }}>
                    <InfoRow label="사망자" value={killedExists ? "있음" : "없음"} />
                    <InfoRow label="사망자 목록" value={showPublic ? (killedList.join(", ") || "-") : "-"} />
                    <InfoRow label="보호 시도" value={protectionAttemptText(!!game.revealed.protectionAttempted)} />
                    <InfoRow
                      label="보호 성공"
                      value={protectionResultText(!!game.revealed.protectionAttempted, game.revealed.protectionResult || "none")}
                    />
                  </div>
                );
              })()}
            </section>

            {/* 행동 정보 */}
            {showActionInfo ? (
              <section style={styles.card}>
                <div style={styles.cardTitle}>행동 정보</div>

                <div style={{ marginTop: 10, color: "#333", lineHeight: 1.7 }}>
                  {roleKey === "hunter" ? (
                    <>
                      <div style={{ fontWeight: 900, color: "#111" }}>사냥꾼 안내</div>
                      <div style={{ marginTop: 6 }}>
                        등산 중, <b>사냥할 동물의 신발 사진</b>을 찍어서 진행자에게 카톡으로 보내세요.
                      </div>
                    </>
                  ) : null}

                  {roleKey === "king" ? (
                    <>
                      <div style={{ fontWeight: 900, color: "#111" }}>동물의 왕 안내</div>
                      <div style={{ marginTop: 6 }}>
                        등산 중, <b>보호할 동물의 손 사진</b>을 찍어서 진행자에게 카톡으로 보내세요. (본인 포함 가능)
                      </div>
                    </>
                  ) : null}

                  <div style={{ marginTop: 12 }}>
                    <a href={KAKAO_URL} target="_blank" rel="noreferrer" style={{ textDecoration: "none" }}>
                      <button style={styles.primaryBtn}>진행자의 카톡으로 가기</button>
                    </a>
                  </div>
                </div>
              </section>
            ) : null}

            {/* ✅ 투표 결과 박스 */}
            {showVote1ResultBox || showVote2ResultBox ? (
              <section style={styles.card}>
                <div style={styles.cardTitle}>투표 결과</div>

                {/* 1차 */}
                {showVote1ResultBox && vote1Block ? (
                  <div style={{ marginTop: 12 }}>
                    <div style={{ fontWeight: 900, color: "#111", marginBottom: 8 }}>1차 투표 결과</div>
                    <VoteResultTable rows={vote1Block.rows} />

                    {String(vote1Block.outcome || "").toLowerCase().includes("fail") ? (
                      <div style={{ marginTop: 12 }}>
                        <div style={{ fontWeight: 900, color: "#111" }}>사냥꾼 색출 실패! GAME OVER ..</div>
                        <img src={hunterWinImg} alt="result_hunter_win" style={styles.resultImg} />
                      </div>
                    ) : String(vote1Block.outcome || "").toLowerCase().includes("success") ? (
                      <div style={{ marginTop: 12 }}>
                        <div style={{ fontWeight: 900, color: "#111" }}>사냥꾼 색출 성공!</div>

                        {(vote1Block.revealedHunters || []).length ? (
                          <div style={{ marginTop: 10, display: "flex", gap: 12, flexWrap: "wrap" }}>
                            {vote1Block.revealedHunters.map((hid) => (
                              <div key={hid} style={styles.revealedCard}>
                                <img
                                  src={hunterProfileUrl(hid)}
                                  alt={`${hid}_hunter`}
                                  style={{ width: 88, height: 88, borderRadius: 14, imageRendering: "pixelated" as any }}
                                />
                                <div style={{ marginTop: 6, fontWeight: 900, color: "#111" }}>{playerNameById(hid)}</div>
                              </div>
                            ))}
                          </div>
                        ) : null}
                      </div>
                    ) : null}
                  </div>
                ) : null}

                {/* 2차 */}
                {showVote2ResultBox && vote2Block ? (
                  <div style={{ marginTop: 18 }}>
                    <div style={{ fontWeight: 900, color: "#111", marginBottom: 8 }}>2차 투표 결과</div>
                    <VoteResultTable rows={vote2Block.rows} />

                    {String(vote2Block.outcome || "").toLowerCase() === "fail" ? (
                      <div style={{ marginTop: 12 }}>
                        <div style={{ fontWeight: 900, color: "#111" }}>사냥꾼 색출 실패! GAME OVER ..</div>
                        <img src={hunterWinImg} alt="result_hunter_win" style={styles.resultImg} />
                      </div>
                    ) : String(vote2Block.outcome || "").toLowerCase() === "success" ? (
                      <div style={{ marginTop: 12 }}>
                        {bothHuntersCaughtOnVote2 ? (
                          <>
                            <div style={{ fontWeight: 900, color: "#111" }}>사냥꾼 색출 성공! 동물들 승리!</div>
                            <img src={animalWinImg} alt="result_animal_win" style={styles.resultImg} />
                          </>
                        ) : (
                          <div style={{ fontWeight: 900, color: "#111" }}>사냥꾼 색출 성공!</div>
                        )}

                        {(() => {
                          const v1 = vote1Block?.revealedHunters || [];
                          const v2 = vote2Block?.revealedHunters || [];
                          const all = Array.from(new Set([...v1, ...v2].filter(Boolean)));
                          if (!all.length) return null;

                          return (
                            <div style={{ marginTop: 10, display: "flex", gap: 12, flexWrap: "wrap" }}>
                              {all.map((hid) => (
                                <div key={hid} style={styles.revealedCard}>
                                  <img
                                    src={hunterProfileUrl(hid)}
                                    alt={`${hid}_hunter`}
                                    style={{ width: 88, height: 88, borderRadius: 14, imageRendering: "pixelated" as any }}
                                  />
                                  <div style={{ marginTop: 6, fontWeight: 900, color: "#111" }}>{playerNameById(hid)}</div>
                                </div>
                              ))}
                            </div>
                          );
                        })()}
                      </div>
                    ) : null}
                  </div>
                ) : null}
              </section>
            ) : null}

            {/* 투표 입력 */}
            <section style={styles.card}>
              <div style={styles.cardTitle}>투표</div>

              <div style={{ marginTop: 10 }}>
                {!alive && (phaseKey === "hikeend" || phaseKey.startsWith("vote") || phaseKey.startsWith("ended")) ? (
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
              <button onClick={() => doLogout()} style={styles.secondaryBtn}>
                로그아웃
              </button>

              <button onClick={() => refreshOnce().catch(() => {})} style={styles.secondaryBtn}>
                새로고침
              </button>
            </div>

            <div style={{ height: 20 }} />
          </>
        )}
      </div>
    </div>
  );
}

function VoteResultTable({ rows }: { rows: VoteSummaryRow[] }) {
  const safeRows = Array.isArray(rows) ? rows : [];
  if (!safeRows.length) {
    return <div style={{ color: "#666" }}>집계된 결과가 아직 없어요.</div>;
  }

  return (
    <div style={{ overflowX: "auto" }}>
      <table style={{ width: "100%", borderCollapse: "collapse", marginTop: 6 }}>
        <thead>
          <tr>
            <th style={styles.th}>득표자</th>
            <th style={styles.th}>득표수</th>
            <th style={styles.th}>사유</th>
          </tr>
        </thead>
        <tbody>
          {safeRows.map((r, idx) => (
            <tr key={`${r.targetId}-${idx}`}>
              <td style={styles.td}>{r.targetName || r.targetId}</td>
              <td style={{ ...styles.td, textAlign: "center", whiteSpace: "nowrap" }}>{r.count}표</td>
              <td style={styles.td}>{(r.reasons || []).join(", ") || "-"}</td>
            </tr>
          ))}
        </tbody>
      </table>
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
    background:
      "linear-gradient(180deg, rgba(255,245,215,1) 0%, rgba(255,255,255,1) 55%, rgba(245,250,255,1) 100%)",
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
    width: "100%",
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
  th: {
    textAlign: "left",
    padding: "10px 10px",
    borderBottom: "1px solid rgba(0,0,0,0.12)",
    fontWeight: 900,
    color: "#222",
    background: "rgba(255,255,255,0.65)",
    whiteSpace: "nowrap",
  },
  td: {
    padding: "10px 10px",
    borderBottom: "1px solid rgba(0,0,0,0.08)",
    color: "#111",
    verticalAlign: "top",
  },
  revealedCard: {
    border: "1px solid rgba(0,0,0,0.10)",
    borderRadius: 14,
    padding: 10,
    background: "rgba(255,255,255,0.65)",
    width: 110,
    textAlign: "center" as const,
  },
  resultImg: {
    width: "100%",
    maxWidth: 680,
    marginTop: 10,
    borderRadius: 14,
    display: "block",
    border: "1px solid rgba(0,0,0,0.10)",
  },
};
