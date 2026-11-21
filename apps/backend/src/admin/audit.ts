import type { AppDeps } from '../types/app.js';
import type { AuditLogDoc } from '../types/domain.js';
import { paths } from '../store/types.js';
import { newId } from '../utils/ids.js';

export async function writeAudit(
  deps: AppDeps,
  input: {
    actorUid: string;
    actorEmail: string;
    action: string;
    targetUserId?: string | null;
    targetDeviceId?: string | null;
    metadata?: Record<string, string | number | boolean | null>;
  },
): Promise<void> {
  const log: AuditLogDoc = {
    logId: newId('audit'),
    actorUid: input.actorUid,
    actorEmail: input.actorEmail,
    action: input.action,
    targetUserId: input.targetUserId ?? null,
    targetDeviceId: input.targetDeviceId ?? null,
    metadata: input.metadata ?? {},
    createdAt: deps.now(),
  };
  await deps.store.set(paths.auditLog(log.logId), { ...log });
}
