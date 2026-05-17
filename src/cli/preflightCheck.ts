/** Minimum |Evernote − vault| gap before emitting a count-mismatch hint. */
export const PREFLIGHT_COUNT_DELTA_THRESHOLD = 5;

export type PreflightWarningCode = 'evernote_more_than_vault' | 'vault_more_than_evernote';

export interface PreflightWarning {
  code: PreflightWarningCode;
  message: string;
}

export function buildPreflightWarnings(
  vaultMarkdown: number,
  evernoteNotes: number,
  threshold = PREFLIGHT_COUNT_DELTA_THRESHOLD,
): PreflightWarning[] {
  const warnings: PreflightWarning[] = [];
  const delta = evernoteNotes - vaultMarkdown;
  if (delta > threshold) {
    warnings.push({
      code: 'evernote_more_than_vault',
      message:
        'hint: Evernote has more notes than vault markdown files; confirm --vault-dir points at the full importer output.',
    });
  } else if (vaultMarkdown - evernoteNotes > threshold) {
    warnings.push({
      code: 'vault_more_than_evernote',
      message:
        'hint: Vault has more markdown files than Evernote snapshot rows; trashed notes may be excluded from the snapshot, or the tree may contain extra non-Evernote notes.',
    });
  }
  return warnings;
}

export interface PreflightHumanFormatInput {
  vaultRoot: string;
  vaultMarkdown: number;
  evernoteNotes: number;
  evernoteLabel: string;
  warnings: readonly PreflightWarning[];
}

export type PreflightFormatContext = 'check' | 'run';

function preflightHeader(context: PreflightFormatContext): string {
  if (context === 'run') {
    return 'Preflight: Evernote vs vault counts (hints only; continuing run…)';
  }
  return 'Preflight: Evernote vs vault counts (hints only; run correlate for GUID ↔ path mapping)';
}

export function formatPreflightHuman(
  input: PreflightHumanFormatInput,
  context: PreflightFormatContext = 'check',
): string {
  const lines = [
    preflightHeader(context),
    '',
    `Vault:     ${input.vaultMarkdown} markdown file${input.vaultMarkdown === 1 ? '' : 's'} under ${input.vaultRoot}`,
    `Evernote:  ${input.evernoteNotes} note${input.evernoteNotes === 1 ? '' : 's'} in ${input.evernoteLabel}`,
    '',
  ];
  for (const w of input.warnings) {
    lines.push(w.message);
  }
  if (input.warnings.length > 0) {
    lines.push('');
  }
  return lines.join('\n');
}
