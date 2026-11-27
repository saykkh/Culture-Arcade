import type { GameId } from '../domain/types'

export function CabinetArtwork({ gameId }: { gameId: GameId }) {
  switch (gameId) {
    case 'typing':
      return (
        <svg viewBox="0 0 280 88" width="100%" height="100%" aria-hidden="true">
          <rect width="280" height="88" fill="#09101a" />
          <line x1="0" y1="68" x2="280" y2="68" stroke="#43E7F2" strokeOpacity="0.35" strokeDasharray="4 3" />
          <rect x="20" y="14" width="76" height="20" rx="4" fill="#13263a" stroke="#43E7F2" />
          <text x="58" y="28" fill="#F2F6FB" fontSize="10" textAnchor="middle">고객 최우선</text>
          <rect x="116" y="30" width="84" height="20" rx="4" fill="#1b3022" stroke="#B9F66C" />
          <text x="158" y="44" fill="#B9F66C" fontSize="10" textAnchor="middle">원칙과 책임</text>
          <rect x="208" y="10" width="58" height="20" rx="4" fill="#13263a" stroke="#43E7F2" />
          <text x="237" y="24" fill="#F2F6FB" fontSize="10" textAnchor="middle">실행력</text>
          <rect x="34" y="73" width="212" height="9" rx="4" fill="#152030" />
          <rect x="34" y="73" width="142" height="9" rx="4" fill="#43E7F2" />
        </svg>
      )
    case 'snake':
      return (
        <svg viewBox="0 0 280 88" width="100%" height="100%" aria-hidden="true">
          <rect width="280" height="88" fill="#091116" />
          <g stroke="#1c2c38" strokeWidth="1">
            <line x1="70" y1="0" x2="70" y2="88" />
            <line x1="140" y1="0" x2="140" y2="88" />
            <line x1="210" y1="0" x2="210" y2="88" />
            <line x1="0" y1="44" x2="280" y2="44" />
          </g>
          <rect x="38" y="34" width="22" height="18" rx="4" fill="#63b83a" />
          <rect x="64" y="34" width="22" height="18" rx="4" fill="#89e051" />
          <rect x="90" y="34" width="26" height="18" rx="4" fill="#B9F66C" />
          <rect x="164" y="28" width="88" height="26" rx="5" fill="#1a2c1e" stroke="#B9F66C" />
          <text x="208" y="45" fill="#F2F6FB" fontSize="11" textAnchor="middle">더 큰 가치를</text>
        </svg>
      )
    case 'shooter':
      return (
        <svg viewBox="0 0 280 88" width="100%" height="100%" aria-hidden="true">
          <rect width="280" height="88" fill="#0c101b" />
          <rect x="24" y="6" width="232" height="16" rx="4" fill="#13253b" stroke="#43E7F2" />
          <text x="140" y="17" fill="#F2F6FB" fontSize="9.5" fontWeight="700" textAnchor="middle">
            Q. 약속한 품질을 끝까지 지키는 핵심가치는?
          </text>
          <rect x="18" y="28" width="72" height="24" rx="5" fill="#1a2f48" stroke="#B9F66C" strokeWidth="1.8" />
          <text x="54" y="44" fill="#B9F66C" fontSize="10" fontWeight="700" textAnchor="middle">1·고객최우선</text>
          <rect x="104" y="28" width="72" height="24" rx="5" fill="#182030" stroke="#6b7a96" />
          <text x="140" y="44" fill="#F2F6FB" fontSize="10" textAnchor="middle">2·열린협력</text>
          <rect x="190" y="28" width="72" height="24" rx="5" fill="#182030" stroke="#6b7a96" />
          <text x="226" y="44" fill="#F2F6FB" fontSize="10" textAnchor="middle">3·원칙책임</text>
          <line x1="54" y1="53" x2="54" y2="70" stroke="#B9F66C" strokeWidth="3" />
          <polygon points="54,68 42,84 66,84" fill="#43E7F2" />
        </svg>
      )
    case 'runner':
      return (
        <svg viewBox="0 0 280 88" width="100%" height="100%" aria-hidden="true">
          <rect width="280" height="88" fill="#090d19" />
          <polygon points="106,14 174,14 256,88 24,88" fill="#132036" stroke="#43E7F2" strokeOpacity="0.6" />
          <line x1="128" y1="14" x2="98" y2="88" stroke="#43E7F2" strokeOpacity="0.4" strokeDasharray="5 4" />
          <line x1="152" y1="14" x2="182" y2="88" stroke="#43E7F2" strokeOpacity="0.4" strokeDasharray="5 4" />
          <rect x="112" y="34" width="56" height="16" rx="4" fill="#132c24" stroke="#B9F66C" strokeWidth="1.8" />
          <text x="140" y="45" fill="#B9F66C" fontSize="9.5" fontWeight="800" textAnchor="middle">⚡C·부스터</text>
          <ellipse cx="204" cy="58" rx="16" ry="8" fill="#3a2f10" stroke="#FFE047" />
          <text x="204" y="61" fill="#FFE047" fontSize="9.5" fontWeight="800" textAnchor="middle">🍌감속</text>
          <rect x="128" y="60" width="24" height="18" rx="5" fill="#FF6B9E" />
          <circle cx="140" cy="54" r="6" fill="#F2F6FB" />
        </svg>
      )
  }
}
