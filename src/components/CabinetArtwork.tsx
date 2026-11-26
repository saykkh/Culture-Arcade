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
          <rect x="18" y="12" width="72" height="22" rx="4" fill="#1d2536" stroke="#6b7a96" />
          <text x="54" y="27" fill="#F2F6FB" fontSize="10" textAnchor="middle">C · 고객</text>
          <rect x="104" y="12" width="72" height="22" rx="4" fill="#2a2415" stroke="#FFBD64" />
          <text x="140" y="27" fill="#FFBD64" fontSize="10" textAnchor="middle">O · 협력</text>
          <rect x="190" y="12" width="72" height="22" rx="4" fill="#1d2536" stroke="#6b7a96" />
          <text x="226" y="27" fill="#F2F6FB" fontSize="10" textAnchor="middle">R · 원칙</text>
          <line x1="140" y1="38" x2="140" y2="62" stroke="#43E7F2" strokeWidth="2.5" strokeDasharray="4 3" />
          <polygon points="140,64 128,82 152,82" fill="#43E7F2" />
        </svg>
      )
    case 'racing':
      return (
        <svg viewBox="0 0 280 88" width="100%" height="100%" aria-hidden="true">
          <rect width="280" height="88" fill="#070d18" />
          <polygon points="110,12 170,12 260,88 20,88" fill="#111d30" stroke="#56A8FF" strokeOpacity="0.5" />
          <line x1="130" y1="12" x2="100" y2="88" stroke="#43E7F2" strokeDasharray="6 5" />
          <line x1="150" y1="12" x2="180" y2="88" stroke="#43E7F2" strokeDasharray="6 5" />
          <rect x="86" y="34" width="26" height="16" rx="3" fill="#FFBD64" />
          <rect x="125" y="58" width="30" height="22" rx="4" fill="#43E7F2" />
          <text x="140" y="24" fill="#8cc4ff" fontSize="10" textAnchor="middle">3D CABLE TUNNEL</text>
        </svg>
      )
    case 'pinball':
      return (
        <svg viewBox="0 0 280 88" width="100%" height="100%" aria-hidden="true">
          <rect width="280" height="88" fill="#0f0b18" />
          <circle cx="82" cy="26" r="13" fill="#231934" stroke="#43E7F2" strokeWidth="2" />
          <text x="82" y="30" fill="#43E7F2" fontSize="11" fontWeight="700" textAnchor="middle">C</text>
          <circle cx="122" cy="20" r="13" fill="#231934" stroke="#B9F66C" strokeWidth="2" />
          <text x="122" y="24" fill="#B9F66C" fontSize="11" fontWeight="700" textAnchor="middle">O</text>
          <circle cx="162" cy="20" r="13" fill="#231934" stroke="#FFBD64" strokeWidth="2" />
          <text x="162" y="24" fill="#FFBD64" fontSize="11" fontWeight="700" textAnchor="middle">R</text>
          <circle cx="202" cy="26" r="13" fill="#231934" stroke="#FF6B9E" strokeWidth="2" />
          <text x="202" y="30" fill="#FF6B9E" fontSize="11" fontWeight="700" textAnchor="middle">E</text>
          <circle cx="144" cy="48" r="6" fill="#F2F6FB" />
          <line x1="92" y1="74" x2="132" y2="66" stroke="#43E7F2" strokeWidth="5" strokeLinecap="round" />
          <line x1="192" y1="74" x2="152" y2="66" stroke="#43E7F2" strokeWidth="5" strokeLinecap="round" />
        </svg>
      )
    case 'control-room':
      return (
        <svg viewBox="0 0 280 88" width="100%" height="100%" aria-hidden="true">
          <rect width="280" height="88" fill="#0d0b1a" />
          <rect x="24" y="16" width="44" height="54" rx="4" fill="#181530" stroke="#A78BFA" />
          <text x="46" y="47" fill="#dcd0ff" fontSize="10" textAnchor="middle">C·O</text>
          <rect x="96" y="22" width="88" height="42" rx="5" fill="#1d1838" stroke="#43E7F2" />
          <text x="140" y="46" fill="#43E7F2" fontSize="10" textAnchor="middle">CENTRAL CONSOLE</text>
          <rect x="212" y="16" width="44" height="54" rx="4" fill="#181530" stroke="#B9F66C" />
          <text x="234" y="47" fill="#B9F66C" fontSize="10" textAnchor="middle">EXIT</text>
        </svg>
      )
  }
}
