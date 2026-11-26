import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { buildTypingSchedule, getContentBundle } from '../../../content'
import { BASE_ACTION_POINTS, normalizePhraseInput, PASSING_SCORE } from '../../domain/rules'
import type { GameMode, RunEndReason, TypingRunEvent } from '../../domain/types'
import { useArcadePreferences } from '../../lib/preferences'
import { playArcadeSfx } from '../../lib/sound'

export interface TypingGameProps {
  seed: number
  mode: GameMode
  contentVersion: string
  isPractice?: boolean
  onPracticeSuccess?: () => void
  onPracticeTimeUp?: () => void
  onFinishRound?: (result: {
    events: TypingRunEvent[]
    activeDurationMs: number
    endReason: RunEndReason
  }) => void
}

/**
 * 산성비 타자 (typing)
 * - 60초(정규) / 75초(지원, 낙하 속도 80%), 16개 슬롯, 5개 놓치면 종료, 10개 입력 클리어
 * - 같은 문구가 화면에 두 개 동시에 있을 때 바닥에 더 가까운(진행률이 큰) 문구 하나를 제거
 * - 한글 IME 조합 중 Enter 제출 및 전역 키 전파 차단
 * - 3연속 성공 시 전류 연출, 오입력/놓침은 연속 횟수만 초기화하고 기존 연결·점수 보존
 */
export function TypingGame({
  seed,
  mode,
  contentVersion,
  isPractice = false,
  onPracticeSuccess,
  onPracticeTimeUp,
  onFinishRound,
}: TypingGameProps) {
  const { prefs } = useArcadePreferences()
  const bundle = useMemo(() => getContentBundle(contentVersion), [contentVersion])
  const schedule = useMemo(() => {
    const full = buildTypingSchedule(bundle, seed, mode)
    if (isPractice) {
      const first = full[0]!
      return [
        {
          ...first,
          spawnMs: 0,
          fallDurationMs: 28_000,
          deadlineMs: 28_000,
          lane: 1,
        },
      ]
    }
    return full
  }, [bundle, seed, mode, isPractice])

  const maxDurationMs = isPractice ? 30_000 : mode === 'assisted' ? 75_000 : 60_000

  const [elapsedMs, setElapsedMs] = useState(0)
  const [paused, setPaused] = useState(false)
  const [inputValue, setInputValue] = useState('')
  const [feedback, setFeedback] = useState<{
    tone: 'neutral' | 'ok' | 'retry'
    text: string
  }>({
    tone: 'neutral',
    text: isPractice
      ? '연습: 낙하하는 공식 문구 1개를 입력하고 Enter를 누르세요.'
      : '낙하하는 공식 문구를 정확히 입력하고 Enter로 케이블을 연결하세요.',
  })
  const [clearedSlotIds, setClearedSlotIds] = useState<number[]>([])
  const [missedSlotIds, setMissedSlotIds] = useState<number[]>([])
  const [combo, setCombo] = useState(0)
  const [surgeActive, setSurgeActive] = useState(false)
  const [practiceCleared, setPracticeCleared] = useState(false)

  const inputRef = useRef<HTMLInputElement | null>(null)
  const isComposingRef = useRef(false)
  const finishedRef = useRef(false)
  const elapsedRef = useRef(0)
  const seqRef = useRef(0)
  const eventsRef = useRef<TypingRunEvent[]>([])
  const clearedSetRef = useRef(new Set<number>())
  const missedSetRef = useRef(new Set<number>())

  useEffect(() => {
    inputRef.current?.focus()
  }, [])

  // Pause timer when browser tab becomes hidden
  useEffect(() => {
    const onVisChange = () => {
      if (document.hidden && !finishedRef.current) {
        setPaused(true)
      }
    }
    document.addEventListener('visibilitychange', onVisChange)
    return () => document.removeEventListener('visibilitychange', onVisChange)
  }, [])

  const finishOnce = useCallback(
    (reason: RunEndReason, finalMs: number) => {
      if (finishedRef.current) return
      finishedRef.current = true
      if (isPractice) {
        onPracticeTimeUp?.()
        return
      }
      onFinishRound?.({
        events: [...eventsRef.current],
        activeDurationMs: Math.min(maxDurationMs, Math.round(finalMs)),
        endReason: reason,
      })
    },
    [isPractice, maxDurationMs, onFinishRound, onPracticeTimeUp],
  )

  useEffect(() => {
    if (paused || finishedRef.current || practiceCleared) return
    let lastTs = performance.now()
    let rafId = 0

    const tick = (nowTs: number) => {
      if (finishedRef.current) return
      const dt = Math.min(100, Math.max(0, nowTs - lastTs))
      lastTs = nowTs
      const nextMs = elapsedRef.current + dt
      elapsedRef.current = nextMs

      // Check newly missed falling slots
      let newlyMissed = false
      for (const slot of schedule) {
        if (
          !clearedSetRef.current.has(slot.slotId) &&
          !missedSetRef.current.has(slot.slotId) &&
          nextMs >= slot.deadlineMs
        ) {
          missedSetRef.current.add(slot.slotId)
          newlyMissed = true
          if (!isPractice) {
            seqRef.current += 1
            eventsRef.current.push({
              seq: seqRef.current,
              t_ms: Math.min(maxDurationMs, Math.round(nextMs)),
              type: 'slot_missed',
              slotId: slot.slotId,
            })
          }
        }
      }

      if (newlyMissed) {
        setMissedSlotIds([...missedSetRef.current])
        setCombo(0)
        playArcadeSfx('wrong')
        setFeedback({
          tone: 'retry',
          text: '문구 1개를 놓쳤습니다 · 이미 연결한 케이블과 점수는 유지됩니다.',
        })
      }

      setElapsedMs(nextMs)

      if (!isPractice && missedSetRef.current.size >= 5) {
        finishOnce('miss_limit', nextMs)
        return
      }
      if (!isPractice && clearedSetRef.current.size + missedSetRef.current.size >= schedule.length) {
        finishOnce('completed_all', nextMs)
        return
      }
      if (nextMs >= maxDurationMs) {
        finishOnce('time_up', maxDurationMs)
        return
      }

      rafId = window.requestAnimationFrame(tick)
    }

    rafId = window.requestAnimationFrame(tick)
    return () => window.cancelAnimationFrame(rafId)
  }, [paused, practiceCleared, schedule, isPractice, maxDurationMs, finishOnce])

  const visibleSlots = schedule.filter(
    (s) =>
      elapsedMs >= s.spawnMs &&
      elapsedMs < s.deadlineMs &&
      !clearedSlotIds.includes(s.slotId) &&
      !missedSlotIds.includes(s.slotId),
  )

  const submitCurrentInput = (rawText: string) => {
    if (finishedRef.current || paused || practiceCleared) return
    const normalized = normalizePhraseInput(rawText)
    if (!normalized) return

    const nowMs = Math.min(maxDurationMs, Math.round(elapsedRef.current))
    const activeCandidates = schedule.filter(
      (s) =>
        nowMs >= s.spawnMs &&
        nowMs < s.deadlineMs &&
        !clearedSetRef.current.has(s.slotId) &&
        !missedSetRef.current.has(s.slotId),
    )

    // Matching candidates sorted by highest progress (closest to bottom first!)
    const matchedCandidates = activeCandidates
      .filter((s) =>
        s.acceptedAnswers.some((ans) => normalizePhraseInput(ans) === normalized),
      )
      .sort((a, b) => {
        const progA = (nowMs - a.spawnMs) / a.fallDurationMs
        const progB = (nowMs - b.spawnMs) / b.fallDurationMs
        return progB - progA
      })

    if (matchedCandidates.length > 0) {
      const target = matchedCandidates[0]!
      clearedSetRef.current.add(target.slotId)
      setClearedSlotIds([...clearedSetRef.current])
      setInputValue('')

      if (isPractice) {
        playArcadeSfx('clear')
        setPracticeCleared(true)
        setFeedback({
          tone: 'ok',
          text: '연습 성공! 공식 문구가 케이블에 연결되었습니다. 바로 본게임을 시작해 보세요.',
        })
        onPracticeSuccess?.()
        return
      }

      seqRef.current += 1
      eventsRef.current.push({
        seq: seqRef.current,
        t_ms: nowMs,
        type: 'submit_phrase',
        slotId: target.slotId,
        input: target.displayKo,
      })

      const nextCombo = combo + 1
      setCombo(nextCombo)
      if (nextCombo % 3 === 0) {
        playArcadeSfx('clear')
        if (!prefs.reduceMotion) {
          setSurgeActive(true)
          window.setTimeout(() => setSurgeActive(false), 750)
        }
        setFeedback({
          tone: 'ok',
          text: `⚡ ${nextCombo}연속 정확 입력! 전류 증폭 발동 (+${BASE_ACTION_POINTS}점)`,
        })
      } else {
        playArcadeSfx('score')
        setFeedback({
          tone: 'ok',
          text: `✓ "${target.displayKo}" 연결 성공 (+${BASE_ACTION_POINTS}점)`,
        })
      }

      if (clearedSetRef.current.size + missedSetRef.current.size >= schedule.length) {
        finishOnce('completed_all', nowMs)
      }
      return
    }

    // Wrong input: zero point deduction, reset combo, keep input editable
    const closestTarget = [...activeCandidates].sort(
      (a, b) => (nowMs - b.spawnMs) / b.fallDurationMs - (nowMs - a.spawnMs) / a.fallDurationMs,
    )[0]
    if (!isPractice && closestTarget) {
      seqRef.current += 1
      eventsRef.current.push({
        seq: seqRef.current,
        t_ms: nowMs,
        type: 'submit_phrase',
        slotId: closestTarget.slotId,
        input: '__wrong__',
      })
    }
    setCombo(0)
    playArcadeSfx('wrong')
    setFeedback({
      tone: 'retry',
      text: '다시 입력 · 오타가 있습니다. 감점은 없으니 문구를 수정해 다시 Enter를 누르세요.',
    })
  }

  const remainingSec = Math.max(0, Math.ceil((maxDurationMs - elapsedMs) / 1000))
  const score = clearedSlotIds.length * BASE_ACTION_POINTS
  const cleared = score >= PASSING_SCORE
  const connectedSegments = Math.min(5, clearedSlotIds.length)

  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        flex: 1,
        gap: 10,
        boxShadow:
          surgeActive && !prefs.reduceMotion
            ? 'inset 0 0 28px rgba(67, 231, 242, 0.55)'
            : undefined,
        borderRadius: 8,
      }}
    >
      {/* HUD */}
      <div className="play-hud-bar">
        <div className="hud-metric">
          <span style={{ color: 'var(--text-muted)' }}>통과 목표 ({PASSING_SCORE}점)</span>
          <strong style={{ color: cleared ? 'var(--accent-clear)' : 'var(--accent-select)' }}>
            {isPractice
              ? `연습 문구 ${practiceCleared ? 1 : 0}/1`
              : cleared
                ? `✓ 통과 달성! · 입력 ${clearedSlotIds.length}개 (고득점 경쟁 중)`
                : `정확히 입력 ${clearedSlotIds.length}/5 (${score}/${PASSING_SCORE}점)`}
          </strong>
          {!isPractice && (
            <span className="mono-num" style={{ fontSize: 13, color: 'var(--text-muted)' }}>
              (전체 {clearedSlotIds.length + missedSlotIds.length}/{schedule.length} · 놓침 {missedSlotIds.length}/5)
            </span>
          )}
        </div>

        <div className="hud-metric" style={{ justifyContent: 'center' }}>
          <span style={{ color: 'var(--text-muted)' }}>남은 시간</span>
          <span
            className="mono-num"
            style={{
              fontSize: 20,
              color: remainingSec <= 10 ? 'var(--accent-warn)' : 'var(--text-primary)',
            }}
          >
            {remainingSec}s
          </span>
        </div>

        <div className="hud-metric" style={{ justifyContent: 'flex-end' }}>
          <span style={{ color: 'var(--text-muted)' }}>연속</span>
          <span className="mono-num" style={{ color: 'var(--accent-select)' }}>
            {combo} COMBO
          </span>
          {!isPractice && (
            <>
              <span style={{ color: 'var(--text-muted)', marginLeft: 8 }}>점수</span>
              <span className="mono-num" style={{ fontSize: 22, color: 'var(--accent-clear)' }}>
                {score}점
              </span>
            </>
          )}
        </div>
      </div>

      {/* In-Monitor 5-Segment Passing Cable Progress */}
      {!isPractice && (
        <div
          aria-label={`모니터 내 통과 케이블 연결 ${connectedSegments}/5`}
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(5, 1fr)',
            gap: 6,
            padding: '0 2px',
          }}
        >
          {Array.from({ length: 5 }, (_, idx) => {
            const lit = idx < connectedSegments
            return (
              <div
                key={idx}
                style={{
                  height: 8,
                  borderRadius: 4,
                  background: lit ? 'var(--accent-clear)' : '#1a2333',
                  boxShadow: lit ? '0 0 8px rgba(185, 246, 108, 0.45)' : undefined,
                }}
              />
            )
          })}
        </div>
      )}

      {/* Falling Phrase Stage (4 non-overlapping columns!) */}
      <div
        style={{
          position: 'relative',
          flex: 1,
          minHeight: 340,
          background: 'linear-gradient(180deg, #090e17 0%, #0e1624 88%, #1a1824 100%)',
          border: '1px solid rgba(67, 231, 242, 0.24)',
          borderRadius: 10,
          overflow: 'hidden',
        }}
      >
        {visibleSlots.map((slot) => {
          const progress = Math.min(1, Math.max(0, (elapsedMs - slot.spawnMs) / slot.fallDurationMs))
          const topPct = 6 + progress * 75
          const leftPct = isPractice ? 25 : 1.5 + slot.lane * 24.5
          const widthPct = isPractice ? 50 : 23
          const nearBottom = progress >= 0.75
          return (
            <div
              key={slot.slotId}
              style={{
                position: 'absolute',
                top: `${topPct}%`,
                left: `${leftPct}%`,
                width: `${widthPct}%`,
                padding: '8px 11px',
                borderRadius: 8,
                background: nearBottom ? 'rgba(46, 26, 24, 0.95)' : 'rgba(18, 32, 50, 0.94)',
                border: `1.5px solid ${nearBottom ? 'var(--accent-warn)' : 'var(--accent-select)'}`,
                color: 'var(--text-primary)',
                fontSize: 15,
                fontWeight: 700,
                lineHeight: 1.35,
                wordBreak: 'keep-all',
                boxShadow: '0 4px 12px rgba(0,0,0,0.45)',
              }}
            >
              <div>{slot.displayKo}</div>
              {nearBottom && (
                <div style={{ fontSize: 11, color: 'var(--accent-warn)', marginTop: 2 }}>
                  ▲ 마감 임박
                </div>
              )}
            </div>
          )
        })}

        {/* Bottom Danger Line */}
        <div
          style={{
            position: 'absolute',
            left: 0,
            right: 0,
            bottom: 18,
            borderTop: '2px dashed rgba(255, 189, 100, 0.5)',
            paddingTop: 3,
            textAlign: 'center',
            fontSize: 12,
            color: 'var(--accent-warn)',
          }}
        >
          바닥 도달 기준선 (5개 놓치면 라운드 종료)
        </div>

        {paused && (
          <div
            style={{
              position: 'absolute',
              inset: 0,
              background: 'rgba(11, 15, 23, 0.88)',
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              justifyContent: 'center',
              gap: 12,
              zIndex: 10,
            }}
          >
            <div style={{ fontSize: 20, fontWeight: 800 }}>일시 정지됨</div>
            <div style={{ color: 'var(--text-muted)', fontSize: 15 }}>
              탭 전환으로 타이머와 조작이 멈췄습니다.
            </div>
            <button
              type="button"
              className="btn-arcade btn-start"
              onClick={() => {
                setPaused(false)
                window.setTimeout(() => inputRef.current?.focus(), 20)
              }}
            >
              ▶ 계속하기
            </button>
          </div>
        )}
      </div>

      {/* Feedback + IME-safe Typing Input */}
      <div
        className={`status-alert ${
          feedback.tone === 'ok' ? 'clear' : feedback.tone === 'retry' ? 'warn' : ''
        }`}
        style={
          feedback.tone === 'neutral'
            ? { background: '#141c28', border: '1px solid var(--border-subtle)' }
            : undefined
        }
      >
        <span>{feedback.text}</span>
      </div>

      <div style={{ display: 'flex', gap: 8 }}>
        <input
          ref={inputRef}
          type="text"
          className="arcade-input"
          value={inputValue}
          disabled={paused || practiceCleared}
          placeholder="여기에 화면의 공식 문구를 그대로 입력하고 Enter를 누르세요"
          aria-label="공식 문구 입력창"
          onChange={(e) => setInputValue(e.target.value)}
          onCompositionStart={() => {
            isComposingRef.current = true
          }}
          onCompositionEnd={() => {
            isComposingRef.current = false
          }}
          onKeyDown={(e) => {
            // Block arrow keys and Enter from bubbling to cabinet/menu shortcuts!
            if (
              e.key === 'ArrowLeft' ||
              e.key === 'ArrowRight' ||
              e.key === 'ArrowUp' ||
              e.key === 'ArrowDown' ||
              e.key === 'Enter'
            ) {
              e.stopPropagation()
            }
            const nativeEv = e.nativeEvent as KeyboardEvent
            if (isComposingRef.current || nativeEv.isComposing || nativeEv.keyCode === 229) {
              return
            }
            if (e.key === 'Enter') {
              e.preventDefault()
              submitCurrentInput(e.currentTarget.value)
            }
          }}
        />
        <button
          type="button"
          className="btn-arcade btn-start"
          disabled={paused || practiceCleared}
          onClick={() => submitCurrentInput(inputValue)}
        >
          연결 (Enter)
        </button>
      </div>
    </div>
  )
}
