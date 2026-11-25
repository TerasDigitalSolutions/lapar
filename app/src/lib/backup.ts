/** Backup destinations (DECISIONS O4): v1 ships only "Download to this device", behind the BackupTarget seam. */
import type { BackupFile, BackupTarget } from '../data/types';

export const downloadTarget: BackupTarget = {
  id: 'download',
  label: 'Download to this device',
  isAvailable: () => typeof document !== 'undefined',
  async save(file: BackupFile) {
    const url = URL.createObjectURL(file.data);
    const a = document.createElement('a');
    a.href = url;
    a.download = file.name;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 10_000);
  },
};

export const backupTargets = (): BackupTarget[] => [downloadTarget].filter((t) => t.isAvailable());
