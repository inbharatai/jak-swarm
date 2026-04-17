import { VoiceLab } from './VoiceLab';

export default function VoiceE2EPage() {
  if (process.env['NODE_ENV'] === 'production') {
    return null;
  }
  return <VoiceLab />;
}
