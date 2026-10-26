import { SampleDataChooser } from './SampleDataChooser';

interface Props {
  /** Kept for callers (Settings → Data); the chooser reports through its own controls. */
  notify?: (message: string, tone?: 'success' | 'error' | 'info') => void;
  onChanged?: () => void;
}

/**
 * Settings → Data "Sample data" card. R6-B4: the same path as the Dashboard and the wizard — samples open in the
 * separate Demo company and are never added to this one (`SampleDataChooser`).
 */
export function SampleDataCard(_props: Props) {
  void _props;
  return <SampleDataChooser variant="card" />;
}
