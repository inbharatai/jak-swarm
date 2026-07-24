// Components rendered on the public homepage.
//
// Product hierarchy:
//   Hero + MultiplayerPreview — the shared human-agent work session
//   MultiplayerSection        — participants, handoffs, redirects, replay
//   EngineDuo                 — Company Brain + Hyperagent foundations
//   CompanyBrain              — evidence graph → drift → executable specs
//   Hyperagent                — governed repair and learning loop
//   HowItWorks                — command-to-delivery runtime
//   ProductCockpit            — workflow cockpit illustration
//   ShowTheWork               — outcome proof cards
//   PainSection               — why fragmented execution breaks
//   TrustLayer + JAKShield    — approvals, security, auditability
//   PremiumCTA                — controlled-beta CTA
export { default as MultiplayerPreview } from './MultiplayerPreview';
export { default as MultiplayerSection } from './MultiplayerSection';
export { default as EngineDuo } from './EngineDuo';
export { default as JAKShield } from './JAKShield';
export { default as HowItWorks } from './HowItWorks';
export { default as PainSection } from './PainSection';
export { default as PremiumCTA } from './PremiumCTA';
export { default as ProductCockpit } from './ProductCockpit';
export { default as ShowTheWork } from './ShowTheWork';
export { default as TrustLayer } from './TrustLayer';
export { default as CompanyBrain } from './CompanyBrain';
export { default as Hyperagent } from './Hyperagent';
export { LandingIcon, type LandingIconName } from './landing-icons';
