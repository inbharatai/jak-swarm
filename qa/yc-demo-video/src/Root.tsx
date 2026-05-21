import React from 'react';
import {
  AbsoluteFill,
  Composition,
  Img,
  interpolate,
  Sequence,
  staticFile,
  useCurrentFrame,
  useVideoConfig,
} from 'remotion';

const FPS = 30;
const WIDTH = 1920;
const HEIGHT = 1080;

const shots = [
  {
    file: '01-landing-hero.png',
    eyebrow: 'JAK Swarm',
    title: 'Turn company context into approved agent work.',
    body: 'A closed-loop beta layer for evidence, drift detection, specs, approvals, and audit trails.',
    accent: '#34d399',
  },
  {
    file: '02-company-os.png',
    eyebrow: 'Company OS foundation',
    title: 'Evidence first. No vibes.',
    body: 'JAK maps artifacts into decisions, tasks, risks, owners, customer signals, specs, and code-change evidence.',
    accent: '#fbbf24',
  },
  {
    file: '03-workspace.png',
    eyebrow: 'Agent cockpit',
    title: 'One surface for agent work.',
    body: 'Goals become plans, routed work, reviewer checkpoints, and traceable outcomes.',
    accent: '#38bdf8',
  },
  {
    file: '04-approvals-inbox.png',
    eyebrow: 'Human control',
    title: 'Risky actions pause before they touch the real world.',
    body: 'Approvals keep high-risk execution permissioned, reviewable, and reversible.',
    accent: '#fb7185',
  },
  {
    file: '05-audit.png',
    eyebrow: 'Trust layer',
    title: 'Every step leaves evidence.',
    body: 'JAK Shield risk-scores actions and preserves audit trails for design-partner validation.',
    accent: '#fb923c',
  },
  {
    file: '06-integrations.png',
    eyebrow: 'Connector roadmap',
    title: 'Connect company tools, then close the loop.',
    body: 'GitHub, Slack, Notion, Linear/Jira, Gmail, Drive, meetings, and support systems become AI-legible context.',
    accent: '#a78bfa',
  },
  {
    file: '07-landing-agent-claims.png',
    eyebrow: 'Landing-page claim',
    title: 'The public page promises tiered access to core and specialist agents.',
    body: 'The current landing copy does not name CEO, CTO, and CMO here; those roles must be proven from the product workspace.',
    accent: '#f472b6',
  },
  {
    file: '08-workspace-role-picker-proof.png',
    eyebrow: 'Role selection proof',
    title: 'The workspace exposes CEO, CTO, and CMO as selectable runtime roles.',
    body: 'These chips map to strategist, technical, and marketing worker roles before a workflow is created.',
    accent: '#60a5fa',
  },
  {
    file: '09-leadership-roundtable-proof.png',
    eyebrow: 'Command proof',
    title: 'A leadership-roundtable command returns role-specific workflow evidence.',
    body: 'Local E2E shows plan creation, CEO/CTO/CMO worker events, and an honest final response boundary.',
    accent: '#34d399',
  },
  {
    file: '10-vibe-builder-entry.png',
    eyebrow: 'Vibe coding',
    title: 'Builder is a real product surface, not only pricing copy.',
    body: 'The dashboard exposes a dedicated Builder route for AI app projects, project creation, file editing, preview, checkpoints, deploy, and GitHub handoff.',
    accent: '#fbbf24',
  },
  {
    file: '11-vibe-builder-prompt-proof.png',
    eyebrow: 'Builder prompt',
    title: 'A user can create a project and submit an app-building prompt.',
    body: 'The local proof drives the same buyer-visible flow: create project, open IDE, describe the app, then dispatch generation.',
    accent: '#38bdf8',
  },
  {
    file: '12-vibe-builder-generated-proof.png',
    eyebrow: 'Generated files proof',
    title: 'The Builder returns files and a ready project state locally.',
    body: 'Honest boundary: this proves the Builder UI/API loop. Live OpenAI generation quality still needs a hosted environment with configured credentials.',
    accent: '#fb923c',
  },
];

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <AbsoluteFill
      style={{
        background:
          'radial-gradient(circle at 15% 10%, rgba(52,211,153,0.20), transparent 34%), radial-gradient(circle at 80% 30%, rgba(251,191,36,0.16), transparent 35%), linear-gradient(135deg, #09090b 0%, #0b1713 55%, #171106 100%)',
        color: 'white',
        fontFamily: 'Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
        overflow: 'hidden',
      }}
    >
      <div
        style={{
          position: 'absolute',
          inset: 0,
          backgroundImage:
            'linear-gradient(rgba(255,255,255,0.035) 1px, transparent 1px), linear-gradient(90deg, rgba(255,255,255,0.035) 1px, transparent 1px)',
          backgroundSize: '64px 64px',
          maskImage: 'radial-gradient(circle at center, black 0%, transparent 76%)',
        }}
      />
      {children}
    </AbsoluteFill>
  );
}

function Badge({ children, color }: { children: React.ReactNode; color: string }) {
  return (
    <div
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: 12,
        border: `1px solid ${color}70`,
        background: `${color}18`,
        color: '#f8fafc',
        borderRadius: 999,
        padding: '12px 18px',
        fontSize: 23,
        fontWeight: 800,
        letterSpacing: 2.4,
        textTransform: 'uppercase',
      }}
    >
      <span
        style={{
          width: 11,
          height: 11,
          borderRadius: 999,
          background: color,
          boxShadow: `0 0 24px ${color}`,
        }}
      />
      {children}
    </div>
  );
}

function Opening() {
  const frame = useCurrentFrame();
  const opacity = interpolate(frame, [0, 18], [0, 1], { extrapolateRight: 'clamp' });
  const y = interpolate(frame, [0, 30], [40, 0], { extrapolateRight: 'clamp' });

  return (
    <Shell>
      <div
        style={{
          position: 'absolute',
          left: 120,
          top: 120,
          width: 1080,
          opacity,
          transform: `translateY(${y}px)`,
        }}
      >
        <Badge color="#34d399">YC demo • beta build</Badge>
        <h1 style={{ fontSize: 112, lineHeight: 1.02, margin: '42px 0 26px', letterSpacing: -5 }}>
          The closed-loop AI operating layer for company execution.
        </h1>
        <p style={{ fontSize: 36, lineHeight: 1.35, color: '#cbd5e1', width: 920 }}>
          JAK turns scattered company artifacts into evidence, detects drift, generates executable specs, gates risky actions, and leaves audit trails.
        </p>
      </div>
      <div
        style={{
          position: 'absolute',
          right: 120,
          bottom: 110,
          width: 520,
          border: '1px solid rgba(255,255,255,0.12)',
          background: 'rgba(15,23,42,0.68)',
          borderRadius: 36,
          padding: 34,
          boxShadow: '0 30px 90px rgba(0,0,0,0.45)',
        }}
      >
        {['Evidence graph', 'Execution drift', 'Agent specs', 'Approvals', 'Audit'].map((item, index) => (
          <div
            key={item}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 18,
              padding: '15px 0',
              color: index < Math.floor(frame / 13) ? '#ffffff' : '#64748b',
              fontSize: 29,
              fontWeight: 760,
            }}
          >
            <span style={{ width: 14, height: 14, borderRadius: 99, background: index < Math.floor(frame / 13) ? '#34d399' : '#334155' }} />
            {item}
          </div>
        ))}
      </div>
    </Shell>
  );
}

function ScreenshotScene({
  shot,
  index,
}: {
  shot: (typeof shots)[number];
  index: number;
}) {
  const frame = useCurrentFrame();
  const progress = interpolate(frame, [0, 34, 170, 210], [0, 1, 1, 0], {
    extrapolateLeft: 'clamp',
    extrapolateRight: 'clamp',
  });
  const zoom = interpolate(frame, [0, 210], [1.04, 1.0]);
  const x = interpolate(frame, [0, 34], [70, 0], { extrapolateRight: 'clamp' });

  return (
    <Shell>
      <div
        style={{
          position: 'absolute',
          top: 84,
          left: 88,
          width: 620,
          opacity: progress,
          transform: `translateX(${x}px)`,
        }}
      >
        <Badge color={shot.accent}>{shot.eyebrow}</Badge>
        <h2 style={{ fontSize: 69, lineHeight: 1.04, margin: '36px 0 22px', letterSpacing: -3 }}>
          {shot.title}
        </h2>
        <p style={{ fontSize: 31, lineHeight: 1.35, color: '#cbd5e1' }}>{shot.body}</p>
        <div style={{ marginTop: 42, display: 'flex', gap: 14, flexWrap: 'wrap' }}>
          {['OpenAI-first', 'JAK Shield', 'Design-partner beta'].map((chip) => (
            <span
              key={chip}
              style={{
                border: '1px solid rgba(255,255,255,0.11)',
                background: 'rgba(255,255,255,0.055)',
                borderRadius: 999,
                padding: '10px 16px',
                color: '#e2e8f0',
                fontSize: 20,
                fontWeight: 700,
              }}
            >
              {chip}
            </span>
          ))}
        </div>
      </div>
      <div
        style={{
          position: 'absolute',
          right: 78,
          top: 92,
          width: 1090,
          height: 704,
          borderRadius: 34,
          overflow: 'hidden',
          border: `2px solid ${shot.accent}55`,
          boxShadow: `0 40px 120px rgba(0,0,0,0.55), 0 0 90px ${shot.accent}22`,
          opacity: progress,
          transform: `scale(${zoom})`,
          background: '#020617',
        }}
      >
        <Img
          src={staticFile(`assets/${shot.file}`)}
          style={{ width: '100%', height: '100%', objectFit: 'cover' }}
        />
      </div>
      <div
        style={{
          position: 'absolute',
          right: 110,
          bottom: 92,
          color: '#94a3b8',
          fontSize: 22,
          fontWeight: 700,
          letterSpacing: 1.4,
        }}
      >
          {String(index + 1).padStart(2, '0')} / {String(shots.length).padStart(2, '0')}
      </div>
    </Shell>
  );
}

function Closing() {
  const frame = useCurrentFrame();
  const opacity = interpolate(frame, [0, 22], [0, 1], { extrapolateRight: 'clamp' });
  return (
    <Shell>
      <div
        style={{
          position: 'absolute',
          inset: 0,
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          textAlign: 'center',
          opacity,
          padding: 120,
        }}
      >
        <Badge color="#34d399">JAK Swarm</Badge>
        <h2 style={{ fontSize: 94, lineHeight: 1.03, margin: '42px 0 24px', letterSpacing: -4, maxWidth: 1320 }}>
          Make the company legible to AI. Then let agents execute safely.
        </h2>
        <p style={{ fontSize: 32, color: '#cbd5e1', maxWidth: 1080, lineHeight: 1.4 }}>
          Beta foundation today: evidence, drift, executable specs, approvals, and audit. Next: live connector sync and hosted production validation.
        </p>
      </div>
    </Shell>
  );
}

export function YCDemo() {
  const sceneLength = 210;
  return (
    <AbsoluteFill>
      <Sequence from={0} durationInFrames={150}>
        <Opening />
      </Sequence>
      {shots.map((shot, index) => (
        <Sequence key={shot.file} from={150 + index * sceneLength} durationInFrames={sceneLength}>
          <ScreenshotScene shot={shot} index={index} />
        </Sequence>
      ))}
      <Sequence from={150 + shots.length * sceneLength} durationInFrames={180}>
        <Closing />
      </Sequence>
    </AbsoluteFill>
  );
}

export function RemotionRoot() {
  const duration = 150 + shots.length * 210 + 180;
  return (
    <Composition
      id="JAKSwarmYCDemo"
      component={YCDemo}
      durationInFrames={duration}
      fps={FPS}
      width={WIDTH}
      height={HEIGHT}
    />
  );
}
