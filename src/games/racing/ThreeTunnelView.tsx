import { useEffect, useRef } from 'react'
import * as THREE from 'three'
import { GATE_ZONE_END_Z, type RacingStateSnapshot } from './engine'

interface ThreeTunnelViewProps {
  snapshot: RacingStateSnapshot
  reduceMotion: boolean
  onWebglError: (reason: string) => void
}

const LANE_X = [-3.2, 0, 3.2] as const

export default function ThreeTunnelView({
  snapshot,
  reduceMotion,
  onWebglError,
}: ThreeTunnelViewProps) {
  const mountRef = useRef<HTMLDivElement | null>(null)
  const snapshotRef = useRef(snapshot)

  useEffect(() => {
    snapshotRef.current = snapshot
  }, [snapshot])

  useEffect(() => {
    const container = mountRef.current
    if (!container) return

    let renderer: THREE.WebGLRenderer
    try {
      renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' })
    } catch {
      onWebglError('WebGL 초기화에 실패하여 간소화 화면으로 전환합니다.')
      return
    }

    const width = container.clientWidth || 880
    const height = container.clientHeight || 310
    renderer.setSize(width, height)
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2))
    container.innerHTML = ''
    container.appendChild(renderer.domElement)

    const onContextLost = (ev: Event) => {
      ev.preventDefault()
      onWebglError('3D 렌더링 컨텍스트가 중단되어 간소화 화면으로 복귀합니다.')
    }
    renderer.domElement.addEventListener('webglcontextlost', onContextLost)

    const scene = new THREE.Scene()
    scene.background = new THREE.Color('#060b14')
    scene.fog = new THREE.Fog('#060b14', 45, 220)

    // Fixed rear camera (no roll, no free steering!)
    const camera = new THREE.PerspectiveCamera(60, width / height, 0.5, 260)
    camera.position.set(0, 4.3, 10.5)
    camera.lookAt(0, 1.4, -36)

    const ambient = new THREE.AmbientLight('#9ec5ff', 0.85)
    scene.add(ambient)
    const keyLight = new THREE.DirectionalLight('#ffffff', 1.1)
    keyLight.position.set(0, 12, 10)
    scene.add(keyLight)

    // Road deck + lane dividers
    const roadGeo = new THREE.PlaneGeometry(11.6, 280)
    const roadMat = new THREE.MeshStandardMaterial({ color: '#101928', roughness: 0.85 })
    const road = new THREE.Mesh(roadGeo, roadMat)
    road.rotation.x = -Math.PI / 2
    road.position.set(0, 0, -120)
    scene.add(road)

    const dividerGeo = new THREE.PlaneGeometry(0.14, 280)
    const dividerMat = new THREE.MeshBasicMaterial({ color: '#43E7F2' })
    for (const dx of [-1.6, 1.6]) {
      const line = new THREE.Mesh(dividerGeo, dividerMat)
      line.rotation.x = -Math.PI / 2
      line.position.set(dx, 0.02, -120)
      scene.add(line)
    }

    // Repeating neon cable tunnel arches
    const archGroup = new THREE.Group()
    const archGeo = new THREE.TorusGeometry(7.2, 0.14, 8, 24, Math.PI)
    const archMat = new THREE.MeshBasicMaterial({ color: '#2b6cb0' })
    const arches: THREE.Mesh[] = []
    for (let i = 0; i < 14; i += 1) {
      const arch = new THREE.Mesh(archGeo, archMat)
      arch.position.set(0, 0, -i * 18)
      arches.push(arch)
      archGroup.add(arch)
    }
    scene.add(archGroup)

    // Gate pillars for Mission / Vision gate
    const leftGateMesh = new THREE.Mesh(
      new THREE.BoxGeometry(3.0, 4.2, 0.6),
      new THREE.MeshBasicMaterial({ color: '#43E7F2', wireframe: true }),
    )
    const rightGateMesh = new THREE.Mesh(
      new THREE.BoxGeometry(3.0, 4.2, 0.6),
      new THREE.MeshBasicMaterial({ color: '#B9F66C', wireframe: true }),
    )
    scene.add(leftGateMesh)
    scene.add(rightGateMesh)

    // Player cable pod car
    const playerCar = new THREE.Group()
    const bodyMesh = new THREE.Mesh(
      new THREE.BoxGeometry(1.9, 0.85, 3.4),
      new THREE.MeshStandardMaterial({ color: '#43E7F2', metalness: 0.35, roughness: 0.3 }),
    )
    bodyMesh.position.y = 0.55
    const cabinMesh = new THREE.Mesh(
      new THREE.BoxGeometry(1.4, 0.55, 1.8),
      new THREE.MeshStandardMaterial({ color: '#0b1626', roughness: 0.2 }),
    )
    cabinMesh.position.set(0, 1.1, -0.1)
    playerCar.add(bodyMesh, cabinMesh)
    scene.add(playerCar)

    // Pool of meshes for track vehicles and obstacles
    const entityMeshes = new Map<string, THREE.Mesh>()
    const vehGeo = new THREE.BoxGeometry(1.85, 1.05, 3.2)
    const vehMat = new THREE.MeshStandardMaterial({ color: '#56A8FF', roughness: 0.4 })
    const obsGeo = new THREE.BoxGeometry(2.1, 1.4, 1.4)
    const obsMat = new THREE.MeshStandardMaterial({ color: '#FF6B7A', roughness: 0.45 })

    let rafId = 0
    const renderLoop = () => {
      const snap = snapshotRef.current
      const targetX = LANE_X[snap.lane]
      playerCar.position.x += (targetX - playerCar.position.x) * (reduceMotion ? 1 : 0.28)
      playerCar.position.z = 0

      // Animate tunnel arches forward relative to z
      archMat.color.set(
        snap.finalSectionLit ? '#B9F66C' : snap.boosterRemainingMs > 0 ? '#43E7F2' : '#2b6cb0',
      )
      const offset = snap.z % 18
      arches.forEach((arch, idx) => {
        arch.position.z = -idx * 18 + offset
      })

      // Position gate portals when approaching GATE_ZONE_END_Z
      const gateRelZ = -(GATE_ZONE_END_Z - snap.z)
      if (!snap.isPractice && gateRelZ > -210 && gateRelZ < 12) {
        leftGateMesh.visible = true
        rightGateMesh.visible = true
        leftGateMesh.position.set(LANE_X[0], 2.1, gateRelZ)
        rightGateMesh.position.set(LANE_X[2], 2.1, gateRelZ)
      } else {
        leftGateMesh.visible = false
        rightGateMesh.visible = false
      }

      // Sync nearby vehicles & obstacles within visible horizon [-220m .. +15m]
      for (const ent of snap.entities) {
        let mesh = entityMeshes.get(ent.id)
        if (!mesh) {
          mesh = new THREE.Mesh(
            ent.kind === 'vehicle' ? vehGeo : obsGeo,
            ent.kind === 'vehicle' ? vehMat : obsMat,
          )
          entityMeshes.set(ent.id, mesh)
          scene.add(mesh)
        }
        const relZ = -(ent.z - snap.z)
        if (relZ < -220 || relZ > 16 || ent.collided) {
          mesh.visible = false
        } else {
          mesh.visible = true
          mesh.position.set(LANE_X[ent.lane], ent.kind === 'vehicle' ? 0.6 : 0.75, relZ)
        }
      }

      renderer.render(scene, camera)
      rafId = window.requestAnimationFrame(renderLoop)
    }

    rafId = window.requestAnimationFrame(renderLoop)

    const onResize = () => {
      if (!container) return
      const w = container.clientWidth || 880
      const h = container.clientHeight || 310
      camera.aspect = w / h
      camera.updateProjectionMatrix()
      renderer.setSize(w, h)
    }
    window.addEventListener('resize', onResize)

    return () => {
      window.cancelAnimationFrame(rafId)
      window.removeEventListener('resize', onResize)
      renderer.domElement.removeEventListener('webglcontextlost', onContextLost)
      roadGeo.dispose()
      roadMat.dispose()
      dividerGeo.dispose()
      dividerMat.dispose()
      archGeo.dispose()
      archMat.dispose()
      vehGeo.dispose()
      vehMat.dispose()
      obsGeo.dispose()
      obsMat.dispose()
      renderer.dispose()
    }
  }, [onWebglError, reduceMotion])

  return (
    <div
      ref={mountRef}
      style={{ width: '100%', height: '100%', minHeight: 290 }}
      aria-label="3D 케이블 터널 레이싱 화면"
    />
  )
}
