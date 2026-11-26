import { useEffect, useRef, useState } from 'react'
import * as THREE from 'three'
import type { CoreValueCode } from '../../domain/types'
import type { ControlRoomSnapshot } from './engine'

export type ControlRoomTarget =
  | { kind: 'clue'; label: string }
  | { kind: 'panel'; code: CoreValueCode; label: string }
  | { kind: 'exit'; label: string }

interface ThreeControlRoomViewProps {
  snapshot: ControlRoomSnapshot
  paused: boolean
  onInteractTarget: (target: ControlRoomTarget) => void
  onPointerLockReleased: () => void
  onWebglError: (reason: string) => void
}

export default function ThreeControlRoomView({
  snapshot,
  paused,
  onInteractTarget,
  onPointerLockReleased,
  onWebglError,
}: ThreeControlRoomViewProps) {
  const mountRef = useRef<HTMLDivElement | null>(null)
  const [aimedTarget, setAimedTarget] = useState<ControlRoomTarget | null>(null)
  const [pointerLocked, setPointerLocked] = useState(false)

  const snapshotRef = useRef(snapshot)
  const pausedRef = useRef(paused)
  const interactCallbackRef = useRef(onInteractTarget)
  const aimedRef = useRef<ControlRoomTarget | null>(null)

  useEffect(() => {
    snapshotRef.current = snapshot
  }, [snapshot])

  useEffect(() => {
    pausedRef.current = paused
  }, [paused])

  useEffect(() => {
    interactCallbackRef.current = onInteractTarget
  }, [onInteractTarget])

  useEffect(() => {
    const container = mountRef.current
    if (!container) return

    let renderer: THREE.WebGLRenderer
    try {
      renderer = new THREE.WebGLRenderer({ antialias: true })
    } catch {
      onWebglError('WebGL을 사용할 수 없어 패널 목록 화면으로 전환합니다.')
      return
    }

    const width = container.clientWidth || 560
    const height = container.clientHeight || 350
    renderer.setSize(width, height)
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2))
    container.innerHTML = ''
    container.appendChild(renderer.domElement)

    const onContextLost = (e: Event) => {
      e.preventDefault()
      onWebglError('3D 관제실 렌더링이 중단되어 패널 목록 모드로 전환합니다.')
    }
    renderer.domElement.addEventListener('webglcontextlost', onContextLost)

    const scene = new THREE.Scene()
    scene.background = new THREE.Color('#090d16')

    const camera = new THREE.PerspectiveCamera(62, width / height, 0.2, 60)
    camera.position.set(0, 1.65, 4.2)
    let yaw = 0
    let pitch = -0.05

    const ambient = new THREE.AmbientLight('#8da8d6', 0.75)
    scene.add(ambient)
    const emergencyLight = new THREE.PointLight('#43E7F2', 1.4, 24)
    emergencyLight.position.set(0, 3.6, 0)
    scene.add(emergencyLight)

    // Low-poly room enclosure (12m x 4m x 12m)
    const roomMesh = new THREE.Mesh(
      new THREE.BoxGeometry(12, 4.2, 12),
      new THREE.MeshStandardMaterial({
        color: '#131c2b',
        roughness: 0.9,
        side: THREE.BackSide,
      }),
    )
    roomMesh.position.set(0, 2.1, 0)
    scene.add(roomMesh)

    const interactiveMeshes: Array<{ mesh: THREE.Mesh; target: ControlRoomTarget }> = []

    // 1) Central Console (Clue station)
    const consoleMesh = new THREE.Mesh(
      new THREE.CylinderGeometry(0.95, 1.15, 1.1, 12),
      new THREE.MeshStandardMaterial({ color: '#243b55', emissive: '#102a43' }),
    )
    consoleMesh.position.set(0, 0.55, 0)
    scene.add(consoleMesh)
    interactiveMeshes.push({
      mesh: consoleMesh,
      target: { kind: 'clue', label: '중앙 콘솔 · 현재 단서 확인' },
    })

    // 2) 4 C.O.R.E. Wall Panels arranged along left & right walls
    const panelSpecs: Array<{
      code: CoreValueCode
      pos: [number, number, number]
      color: string
    }> = [
      { code: 'C', pos: [-4.6, 1.7, 1.5], color: '#43E7F2' },
      { code: 'O', pos: [-4.6, 1.7, -2.0], color: '#B9F66C' },
      { code: 'R', pos: [4.6, 1.7, 1.5], color: '#FFBD64' },
      { code: 'E', pos: [4.6, 1.7, -2.0], color: '#FF6B9E' },
    ]
    const panelMeshes = new Map<CoreValueCode, THREE.Mesh>()
    for (const p of panelSpecs) {
      const mat = new THREE.MeshStandardMaterial({
        color: p.color,
        roughness: 0.35,
        emissive: '#09101a',
      })
      const mesh = new THREE.Mesh(new THREE.BoxGeometry(0.45, 1.4, 1.4), mat)
      mesh.position.set(p.pos[0], p.pos[1], p.pos[2])
      scene.add(mesh)
      panelMeshes.set(p.code, mesh)
      interactiveMeshes.push({
        mesh,
        target: { kind: 'panel', code: p.code, label: `[${p.code}] 핵심가치 제어 패널` },
      })
    }

    // 3) Exit Door on North Wall (z = -5.7)
    const exitMat = new THREE.MeshStandardMaterial({
      color: '#323f52',
      emissive: '#1a1020',
      roughness: 0.4,
    })
    const exitMesh = new THREE.Mesh(new THREE.BoxGeometry(2.4, 2.8, 0.35), exitMat)
    exitMesh.position.set(0, 1.4, -5.75)
    scene.add(exitMesh)
    interactiveMeshes.push({
      mesh: exitMesh,
      target: { kind: 'exit', label: '관제실 출구 개폐 장치' },
    })

    // Movement & camera controls
    const keys = { w: false, a: false, s: false, d: false, rotL: false, rotR: false }
    let hadLock = false

    const onKeyDown = (e: KeyboardEvent) => {
      if (pausedRef.current) return
      if (e.key === 'w' || e.key === 'W' || e.key === 'ArrowUp') keys.w = true
      else if (e.key === 's' || e.key === 'S' || e.key === 'ArrowDown') keys.s = true
      else if (e.key === 'a' || e.key === 'A') keys.a = true
      else if (e.key === 'd' || e.key === 'D') keys.d = true
      else if (e.key === 'ArrowLeft') keys.rotL = true
      else if (e.key === 'ArrowRight') keys.rotR = true
      else if ((e.key === 'e' || e.key === 'E') && aimedRef.current) {
        e.preventDefault()
        interactCallbackRef.current(aimedRef.current)
      }
    }

    const onKeyUp = (e: KeyboardEvent) => {
      if (e.key === 'w' || e.key === 'W' || e.key === 'ArrowUp') keys.w = false
      else if (e.key === 's' || e.key === 'S' || e.key === 'ArrowDown') keys.s = false
      else if (e.key === 'a' || e.key === 'A') keys.a = false
      else if (e.key === 'd' || e.key === 'D') keys.d = false
      else if (e.key === 'ArrowLeft') keys.rotL = false
      else if (e.key === 'ArrowRight') keys.rotR = false
    }

    const onMouseMove = (e: MouseEvent) => {
      if (document.pointerLockElement !== renderer.domElement || pausedRef.current) return
      yaw -= e.movementX * 0.0024
      pitch = Math.max(-0.7, Math.min(0.7, pitch - e.movementY * 0.002))
    }

    const onPointerLockChange = () => {
      const isNowLocked = document.pointerLockElement === renderer.domElement
      setPointerLocked(isNowLocked)
      if (isNowLocked) {
        hadLock = true
      } else if (hadLock && !snapshotRef.current.exitActivated) {
        hadLock = false
        keys.w = false
        keys.a = false
        keys.s = false
        keys.d = false
        keys.rotL = false
        keys.rotR = false
        onPointerLockReleased()
      }
    }

    const raycaster = new THREE.Raycaster()
    const centerNdc = new THREE.Vector2(0, 0)

    const onCanvasClick = (e: MouseEvent) => {
      if (pausedRef.current) return
      const rect = renderer.domElement.getBoundingClientRect()
      const clickNdc =
        document.pointerLockElement === renderer.domElement
          ? centerNdc
          : new THREE.Vector2(
              ((e.clientX - rect.left) / rect.width) * 2 - 1,
              -((e.clientY - rect.top) / rect.height) * 2 + 1,
            )

      raycaster.setFromCamera(clickNdc, camera)
      const hits = raycaster.intersectObjects(
        interactiveMeshes.map((m) => m.mesh),
        false,
      )
      if (hits.length > 0 && hits[0]!.distance <= 9.5) {
        const hitEntry = interactiveMeshes.find((m) => m.mesh === hits[0]!.object)
        if (hitEntry) {
          interactCallbackRef.current(hitEntry.target)
          return
        }
      }

      if (document.pointerLockElement !== renderer.domElement && renderer.domElement.requestPointerLock) {
        try {
          void renderer.domElement.requestPointerLock()
        } catch {
          // Ignore pointer lock rejection
        }
      }
    }

    window.addEventListener('keydown', onKeyDown)
    window.addEventListener('keyup', onKeyUp)
    window.addEventListener('mousemove', onMouseMove)
    document.addEventListener('pointerlockchange', onPointerLockChange)
    renderer.domElement.addEventListener('click', onCanvasClick)

    let lastTs = performance.now()
    let rafId = 0
    const loop = (nowTs: number) => {
      const dt = Math.min(0.1, Math.max(0, (nowTs - lastTs) / 1000))
      lastTs = nowTs

      if (!pausedRef.current) {
        if (keys.rotL) yaw += 1.7 * dt
        if (keys.rotR) yaw -= 1.7 * dt

        const forwardX = -Math.sin(yaw)
        const forwardZ = -Math.cos(yaw)
        const rightX = Math.cos(yaw)
        const rightZ = -Math.sin(yaw)

        const moveSpeed = 3.8 * dt
        if (keys.w) {
          camera.position.x += forwardX * moveSpeed
          camera.position.z += forwardZ * moveSpeed
        }
        if (keys.s) {
          camera.position.x -= forwardX * moveSpeed
          camera.position.z -= forwardZ * moveSpeed
        }
        if (keys.d) {
          camera.position.x += rightX * moveSpeed
          camera.position.z += rightZ * moveSpeed
        }
        if (keys.a) {
          camera.position.x -= rightX * moveSpeed
          camera.position.z -= rightZ * moveSpeed
        }

        camera.position.x = Math.max(-4.1, Math.min(4.1, camera.position.x))
        camera.position.z = Math.max(-4.6, Math.min(4.8, camera.position.z))
      }

      camera.rotation.order = 'YXZ'
      camera.rotation.y = yaw
      camera.rotation.x = pitch

      // Reflect stage restoration lighting in 3D room
      const snap = snapshotRef.current
      emergencyLight.intensity = 0.9 + snap.currentStage * 0.45
      emergencyLight.color.set(snap.exitPowerRestored ? '#B9F66C' : '#43E7F2')
      exitMat.color.set(snap.exitPowerRestored ? '#B9F66C' : '#323f52')
      exitMat.emissive.set(snap.exitPowerRestored ? '#2d5a18' : '#1a1020')

      for (const [code, mesh] of panelMeshes.entries()) {
        const restored = snap.restoredDevices.some((d) => d.panelCode === code)
        const mat = mesh.material as THREE.MeshStandardMaterial
        mat.emissive.set(restored ? '#2a5a28' : '#09101a')
      }

      // Update center crosshair raycast target
      raycaster.setFromCamera(centerNdc, camera)
      const hits = raycaster.intersectObjects(
        interactiveMeshes.map((m) => m.mesh),
        false,
      )
      const found =
        hits.length > 0 && hits[0]!.distance <= 9.5
          ? interactiveMeshes.find((m) => m.mesh === hits[0]!.object)?.target ?? null
          : null
      if (aimedRef.current?.label !== found?.label) {
        aimedRef.current = found
        setAimedTarget(found)
      }

      renderer.render(scene, camera)
      rafId = window.requestAnimationFrame(loop)
    }

    rafId = window.requestAnimationFrame(loop)

    return () => {
      window.cancelAnimationFrame(rafId)
      window.removeEventListener('keydown', onKeyDown)
      window.removeEventListener('keyup', onKeyUp)
      window.removeEventListener('mousemove', onMouseMove)
      document.removeEventListener('pointerlockchange', onPointerLockChange)
      renderer.domElement.removeEventListener('click', onCanvasClick)
      renderer.domElement.removeEventListener('webglcontextlost', onContextLost)
      renderer.dispose()
    }
  }, [onPointerLockReleased, onWebglError])

  return (
    <div style={{ position: 'relative', width: '100%', height: '100%', minHeight: 330 }}>
      <div ref={mountRef} style={{ width: '100%', height: '100%', minHeight: 330 }} />

      {/* Center Reticle + Aimed Object Label */}
      <div
        style={{
          position: 'absolute',
          top: '50%',
          left: '50%',
          transform: 'translate(-50%, -50%)',
          pointerEvents: 'none',
          textAlign: 'center',
        }}
      >
        <div
          style={{
            width: 12,
            height: 12,
            borderRadius: '50%',
            border: `2px solid ${aimedTarget ? '#B9F66C' : 'rgba(242,246,251,0.65)'}`,
            margin: '0 auto',
          }}
        />
        {aimedTarget && (
          <div
            style={{
              marginTop: 8,
              padding: '3px 9px',
              borderRadius: 6,
              background: 'rgba(11, 15, 23, 0.88)',
              border: '1px solid #B9F66C',
              color: '#B9F66C',
              fontSize: 12,
              fontWeight: 700,
              whiteSpace: 'nowrap',
            }}
          >
            [E 또는 클릭] {aimedTarget.label}
          </div>
        )}
      </div>

      <div
        style={{
          position: 'absolute',
          left: 10,
          bottom: 8,
          fontSize: 12,
          color: 'var(--text-muted)',
          background: 'rgba(11,15,23,0.78)',
          padding: '3px 8px',
          borderRadius: 5,
        }}
      >
        {pointerLocked
          ? '마우스 시점 고정 중 (Esc로 마우스 해제) · WASD 이동 · E/클릭 상호작용'
          : 'WASD/방향키 이동 · 패널 클릭 또는 우측 [패널 목록]으로 바로 조작 가능'}
      </div>
    </div>
  )
}
