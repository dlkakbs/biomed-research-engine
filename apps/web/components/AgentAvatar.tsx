import type { ReactElement } from 'react';

interface AvatarProps {
  agentId: string;
  active?: boolean;
  done?: boolean;
}

// Each agent has a distinct SVG character — simple but recognizable
const AVATARS: Record<string, (color: string) => ReactElement> = {
  pi: (c) => (
    <svg viewBox="0 0 80 80" fill="none" xmlns="http://www.w3.org/2000/svg">
      {/* Director chair */}
      <rect x="20" y="58" width="40" height="6" rx="3" fill={c} opacity="0.3"/>
      <rect x="24" y="52" width="32" height="8" rx="2" fill={c} opacity="0.5"/>
      {/* Body */}
      <rect x="28" y="38" width="24" height="16" rx="4" fill={c} opacity="0.8"/>
      {/* Head */}
      <circle cx="40" cy="28" r="10" fill={c}/>
      {/* Hair — short, authoritative */}
      <rect x="30" y="18" width="20" height="5" rx="2.5" fill={c} opacity="0.6"/>
      {/* Eyes */}
      <circle cx="36" cy="27" r="1.5" fill="white"/>
      <circle cx="44" cy="27" r="1.5" fill="white"/>
      {/* Glasses */}
      <rect x="32" y="24" width="7" height="5" rx="2" stroke="white" strokeWidth="1.2" fill="none"/>
      <rect x="41" y="24" width="7" height="5" rx="2" stroke="white" strokeWidth="1.2" fill="none"/>
      <line x1="39" y1="26.5" x2="41" y2="26.5" stroke="white" strokeWidth="1.2"/>
      {/* Mouth */}
      <path d="M36 33 Q40 36 44 33" stroke="white" strokeWidth="1" fill="none" strokeLinecap="round"/>
      {/* Collar/tie */}
      <path d="M36 38 L40 44 L44 38" fill="white" opacity="0.3"/>
    </svg>
  ),

  literature: (c) => (
    <svg viewBox="0 0 80 80" fill="none" xmlns="http://www.w3.org/2000/svg">
      {/* Books on desk */}
      <rect x="14" y="55" width="8" height="12" rx="1" fill={c} opacity="0.5"/>
      <rect x="23" y="52" width="8" height="15" rx="1" fill={c} opacity="0.7"/>
      <rect x="52" y="54" width="8" height="13" rx="1" fill={c} opacity="0.5"/>
      {/* Body */}
      <rect x="28" y="38" width="24" height="16" rx="4" fill={c} opacity="0.8"/>
      {/* Head */}
      <circle cx="40" cy="28" r="10" fill={c}/>
      {/* Hair — long */}
      <ellipse cx="40" cy="22" rx="11" ry="5" fill={c} opacity="0.7"/>
      <rect x="29" y="22" width="4" height="12" rx="2" fill={c} opacity="0.7"/>
      <rect x="47" y="22" width="4" height="12" rx="2" fill={c} opacity="0.7"/>
      {/* Eyes */}
      <circle cx="36.5" cy="27" r="1.5" fill="white"/>
      <circle cx="43.5" cy="27" r="1.5" fill="white"/>
      {/* Smile */}
      <path d="M37 32 Q40 35 43 32" stroke="white" strokeWidth="1.2" fill="none" strokeLinecap="round"/>
      {/* Open book in hand */}
      <rect x="30" y="46" width="10" height="8" rx="1" fill="white" opacity="0.2"/>
      <line x1="35" y1="46" x2="35" y2="54" stroke="white" strokeWidth="0.8" opacity="0.4"/>
    </svg>
  ),

  drugdb: (c) => (
    <svg viewBox="0 0 80 80" fill="none" xmlns="http://www.w3.org/2000/svg">
      {/* Lab flask */}
      <path d="M52 60 L56 50 L60 60 Z" fill={c} opacity="0.4"/>
      <rect x="53" y="46" width="6" height="6" rx="1" fill={c} opacity="0.4"/>
      {/* Test tube */}
      <rect x="16" y="50" width="5" height="14" rx="2.5" fill={c} opacity="0.5"/>
      {/* Body */}
      <rect x="28" y="38" width="24" height="16" rx="4" fill={c} opacity="0.8"/>
      {/* Lab coat detail */}
      <rect x="34" y="38" width="12" height="16" rx="2" fill="white" opacity="0.15"/>
      {/* Head */}
      <circle cx="40" cy="28" r="10" fill={c}/>
      {/* Hair — short sides */}
      <rect x="30" y="19" width="20" height="6" rx="3" fill={c} opacity="0.6"/>
      {/* Eyes */}
      <circle cx="36.5" cy="27" r="1.5" fill="white"/>
      <circle cx="43.5" cy="27" r="1.5" fill="white"/>
      {/* Neutral expression */}
      <line x1="37" y1="33" x2="43" y2="33" stroke="white" strokeWidth="1.2" strokeLinecap="round"/>
      {/* Pocket protector */}
      <rect x="34" y="40" width="5" height="8" rx="1" fill="white" opacity="0.2"/>
    </svg>
  ),

  pathway: (c) => (
    <svg viewBox="0 0 80 80" fill="none" xmlns="http://www.w3.org/2000/svg">
      {/* Network nodes on desk */}
      <circle cx="18" cy="60" r="3" fill={c} opacity="0.5"/>
      <circle cx="28" cy="55" r="3" fill={c} opacity="0.5"/>
      <line x1="18" y1="60" x2="28" y2="55" stroke={c} strokeWidth="1" opacity="0.4"/>
      <circle cx="62" cy="58" r="3" fill={c} opacity="0.5"/>
      <line x1="28" y1="55" x2="62" y2="58" stroke={c} strokeWidth="1" opacity="0.4"/>
      {/* Body */}
      <rect x="28" y="38" width="24" height="16" rx="4" fill={c} opacity="0.8"/>
      {/* Head */}
      <circle cx="40" cy="28" r="10" fill={c}/>
      {/* Hair — curly/wavy */}
      <ellipse cx="40" cy="20" rx="10" ry="4" fill={c} opacity="0.6"/>
      <circle cx="31" cy="22" r="3" fill={c} opacity="0.6"/>
      <circle cx="49" cy="22" r="3" fill={c} opacity="0.6"/>
      {/* Eyes — wide curious */}
      <circle cx="36.5" cy="27" r="2" fill="white"/>
      <circle cx="43.5" cy="27" r="2" fill="white"/>
      <circle cx="37" cy="27" r="1" fill={c}/>
      <circle cx="44" cy="27" r="1" fill={c}/>
      {/* Smile */}
      <path d="M36 32 Q40 36 44 32" stroke="white" strokeWidth="1.2" fill="none" strokeLinecap="round"/>
    </svg>
  ),

  repurposing: (c) => (
    <svg viewBox="0 0 80 80" fill="none" xmlns="http://www.w3.org/2000/svg">
      {/* Lightbulb idea */}
      <circle cx="62" cy="22" r="7" fill={c} opacity="0.3"/>
      <path d="M59 29 L59 33 L65 33 L65 29" fill={c} opacity="0.3"/>
      <line x1="62" y1="15" x2="62" y2="12" stroke={c} strokeWidth="1.5" opacity="0.4"/>
      <line x1="55" y1="17" x2="53" y2="15" stroke={c} strokeWidth="1.5" opacity="0.4"/>
      <line x1="69" y1="17" x2="71" y2="15" stroke={c} strokeWidth="1.5" opacity="0.4"/>
      {/* Body */}
      <rect x="28" y="38" width="24" height="16" rx="4" fill={c} opacity="0.8"/>
      {/* Head */}
      <circle cx="40" cy="28" r="10" fill={c}/>
      {/* Spiky/energetic hair */}
      <path d="M30 22 L33 15 L36 21 L39 14 L42 21 L45 15 L48 22" stroke={c} strokeWidth="2" fill="none" opacity="0.7"/>
      {/* Eyes — excited */}
      <circle cx="36.5" cy="27" r="2" fill="white"/>
      <circle cx="43.5" cy="27" r="2" fill="white"/>
      <circle cx="37" cy="27" r="1" fill={c}/>
      <circle cx="44" cy="27" r="1" fill={c}/>
      {/* Big grin */}
      <path d="M34 31 Q40 37 46 31" stroke="white" strokeWidth="1.5" fill="none" strokeLinecap="round"/>
    </svg>
  ),

  evidence: (c) => (
    <svg viewBox="0 0 80 80" fill="none" xmlns="http://www.w3.org/2000/svg">
      {/* Bar chart on desk */}
      <rect x="14" y="58" width="5" height="8" rx="1" fill={c} opacity="0.4"/>
      <rect x="21" y="52" width="5" height="14" rx="1" fill={c} opacity="0.5"/>
      <rect x="28" y="56" width="5" height="10" rx="1" fill={c} opacity="0.4"/>
      {/* Body */}
      <rect x="28" y="38" width="24" height="16" rx="4" fill={c} opacity="0.8"/>
      {/* Head */}
      <circle cx="40" cy="28" r="10" fill={c}/>
      {/* Hair — neat bun */}
      <circle cx="40" cy="19" r="5" fill={c} opacity="0.6"/>
      <ellipse cx="40" cy="22" rx="10" ry="4" fill={c} opacity="0.5"/>
      {/* Eyes — focused */}
      <circle cx="36.5" cy="28" r="1.5" fill="white"/>
      <circle cx="43.5" cy="28" r="1.5" fill="white"/>
      {/* Focused brow */}
      <line x1="34" y1="24" x2="39" y2="25" stroke="white" strokeWidth="1.2" strokeLinecap="round" opacity="0.6"/>
      <line x1="41" y1="25" x2="46" y2="24" stroke="white" strokeWidth="1.2" strokeLinecap="round" opacity="0.6"/>
      {/* Thoughtful expression */}
      <path d="M37 33 Q40 35 43 33" stroke="white" strokeWidth="1" fill="none" strokeLinecap="round"/>
      {/* Clipboard */}
      <rect x="42" y="42" width="8" height="10" rx="1" fill="white" opacity="0.2"/>
      <line x1="44" y1="45" x2="48" y2="45" stroke="white" strokeWidth="0.8" opacity="0.4"/>
      <line x1="44" y1="48" x2="48" y2="48" stroke="white" strokeWidth="0.8" opacity="0.4"/>
    </svg>
  ),

  report: (c) => (
    <svg viewBox="0 0 80 80" fill="none" xmlns="http://www.w3.org/2000/svg">
      {/* Papers/report on desk */}
      <rect x="12" y="54" width="14" height="18" rx="2" fill={c} opacity="0.3"/>
      <rect x="14" y="52" width="14" height="18" rx="2" fill={c} opacity="0.4"/>
      <line x1="16" y1="57" x2="26" y2="57" stroke="white" strokeWidth="0.8" opacity="0.4"/>
      <line x1="16" y1="61" x2="26" y2="61" stroke="white" strokeWidth="0.8" opacity="0.4"/>
      <line x1="16" y1="65" x2="22" y2="65" stroke="white" strokeWidth="0.8" opacity="0.4"/>
      {/* Body */}
      <rect x="28" y="38" width="24" height="16" rx="4" fill={c} opacity="0.8"/>
      {/* Head */}
      <circle cx="40" cy="28" r="10" fill={c}/>
      {/* Elegant hair */}
      <ellipse cx="40" cy="21" rx="10" ry="4" fill={c} opacity="0.6"/>
      <path d="M30 22 Q28 28 30 34" stroke={c} strokeWidth="3" fill="none" opacity="0.5"/>
      {/* Eyes — serene */}
      <circle cx="36.5" cy="28" r="1.5" fill="white"/>
      <circle cx="43.5" cy="28" r="1.5" fill="white"/>
      {/* Confident smile */}
      <path d="M36 32 Q40 36 44 32" stroke="white" strokeWidth="1.2" fill="none" strokeLinecap="round"/>
      {/* Pen in hand */}
      <rect x="50" y="44" width="2" height="10" rx="1" fill="white" opacity="0.4" transform="rotate(-20 50 44)"/>
    </svg>
  ),

  evaluator_1: (c) => <EvaluatorAvatar color={c} variant={1} />,
  evaluator_2: (c) => <EvaluatorAvatar color={c} variant={2} />,
  evaluator_3: (c) => <EvaluatorAvatar color={c} variant={3} />,
};

function EvaluatorAvatar({ color, variant }: { color: string; variant: 1 | 2 | 3 }) {
  const hairStyles = [
    // variant 1: short flat
    <rect key="h" x="30" y="19" width="20" height="5" rx="2.5" fill={color} opacity="0.6"/>,
    // variant 2: bald + beard
    <path key="h" d="M34 32 Q40 37 46 32 L46 36 Q40 40 34 36 Z" fill={color} opacity="0.5"/>,
    // variant 3: long
    <><ellipse key="h1" cx="40" cy="21" rx="11" ry="4" fill={color} opacity="0.6"/>
      <rect key="h2" x="29" y="22" width="4" height="10" rx="2" fill={color} opacity="0.5"/>
      <rect key="h3" x="47" y="22" width="4" height="10" rx="2" fill={color} opacity="0.5"/></>,
  ];
  return (
    <svg viewBox="0 0 80 80" fill="none" xmlns="http://www.w3.org/2000/svg">
      {/* Scale of justice */}
      <line x1="58" y1="20" x2="58" y2="36" stroke={color} strokeWidth="1.5" opacity="0.4"/>
      <line x1="52" y1="24" x2="64" y2="24" stroke={color} strokeWidth="1.5" opacity="0.4"/>
      <path d="M52 24 L49 30 L55 30 Z" stroke={color} strokeWidth="1" fill={color} opacity="0.3"/>
      <path d="M64 24 L61 30 L67 30 Z" stroke={color} strokeWidth="1" fill={color} opacity="0.3"/>
      {/* Body */}
      <rect x="28" y="38" width="24" height="16" rx="4" fill={color} opacity="0.8"/>
      {/* Head */}
      <circle cx="40" cy="28" r="10" fill={color}/>
      {hairStyles[variant - 1]}
      {/* Eyes */}
      <circle cx="36.5" cy="27" r="1.5" fill="white"/>
      <circle cx="43.5" cy="27" r="1.5" fill="white"/>
      {/* Stern expression */}
      <line x1="36" y1="33" x2="44" y2="33" stroke="white" strokeWidth="1" strokeLinecap="round"/>
    </svg>
  );
}

const AGENT_COLORS: Record<string, string> = {
  pi:          '#818cf8',
  literature:  '#34d399',
  drugdb:      '#34d399',
  pathway:     '#34d399',
  repurposing: '#fbbf24',
  evidence:    '#fbbf24',
  report:      '#f472b6',
  evaluator_1: '#c084fc',
  evaluator_2: '#c084fc',
  evaluator_3: '#c084fc',
};

const STATUS_TINT: Record<string, string> = {
  idle:   '0.5',
  active: '1',
  done:   '0.85',
  error:  '0.5',
};

export function AgentAvatar({ agentId, active, done }: AvatarProps) {
  const status = active ? 'active' : done ? 'done' : 'idle';
  const color = AGENT_COLORS[agentId] ?? '#6b7280';
  const opacity = STATUS_TINT[status];
  const fn = AVATARS[agentId];

  return (
    <div
      className="w-full h-full transition-all duration-500"
      style={{ opacity }}
    >
      {fn ? fn(color) : null}
    </div>
  );
}
