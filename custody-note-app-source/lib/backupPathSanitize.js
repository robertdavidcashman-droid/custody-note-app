'use strict';

/**
 * Cross-platform backup path sanitisation.
 * After Mac↔Windows DB restore, settings.backupFolder can hold a foreign OS path
 * that silently disables local backups (mkdir/write fails or is never attempted).
 */

/**
 * @param {string|null|undefined} folderPath
 * @param {{ platform?: string }} [opts]
 * @returns {{ usable: boolean, reason?: string }}
 */
function assessBackupPathUsability(folderPath, opts = {}) {
  const platform = opts.platform || process.platform;
  if (folderPath == null || String(folderPath).trim() === '') {
    return { usable: false, reason: 'empty' };
  }
  const p = String(folderPath).trim();

  if (platform === 'win32') {
    // Unix absolute paths are not usable on Windows (except UNC //server/share).
    if (p.startsWith('/') && !p.startsWith('//')) {
      return { usable: false, reason: 'unix_path_on_windows' };
    }
    if (/^\/(Users|home|private|var|tmp|Volumes)\//i.test(p)) {
      return { usable: false, reason: 'unix_path_on_windows' };
    }
  } else {
    // Drive-letter or UNC paths are not usable on macOS/Linux.
    if (/^[A-Za-z]:[\\/]/.test(p) || p.startsWith('\\\\')) {
      return { usable: false, reason: 'windows_path_on_unix' };
    }
  }
  return { usable: true };
}

/**
 * Decide whether to reset a stored backup folder to the platform default.
 * @returns {{ reset: boolean, reason?: string, previous?: string, next?: string }}
 */
function planBackupFolderReset({
  storedPath,
  defaultPath,
  platform,
  canCreate,
} = {}) {
  const assessment = assessBackupPathUsability(storedPath, { platform });
  if (!assessment.usable) {
    return {
      reset: true,
      reason: assessment.reason || 'unusable',
      previous: storedPath || null,
      next: defaultPath || null,
    };
  }
  if (typeof canCreate === 'function') {
    try {
      if (!canCreate(storedPath)) {
        return {
          reset: true,
          reason: 'cannot_create_or_write',
          previous: storedPath || null,
          next: defaultPath || null,
        };
      }
    } catch (_) {
      return {
        reset: true,
        reason: 'cannot_create_or_write',
        previous: storedPath || null,
        next: defaultPath || null,
      };
    }
  }
  return { reset: false, previous: storedPath || null, next: storedPath || null };
}

module.exports = {
  assessBackupPathUsability,
  planBackupFolderReset,
};
