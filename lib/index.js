import z from '@deepseek-ai/schemastery';
import { credentialRef } from '@deepseek-ai/dsh-credentials';
import { launchEnvironmentOf } from '@deepseek-ai/dsh-launch-environment';
import { UsageService } from './usage.js';
import { createRoutes } from './routes.js';

export const name = 'sub2api-usage-view';
export const inject = ['webServer'];
export const Config = z.object({
  enabled: z.boolean().default(true).volatile(),
  baseURL: z.string().default('').volatile(),
  adminKeyRef: z.string().role('credential-ref').default('SUB2API_ADMIN_KEY').volatile(),
  accountId: z.string().default('').volatile(),
  refreshSeconds: z.number().step(1).min(30).max(3600).default(60).volatile(),
  usageSource: z.union(['auto', 'active', 'passive']).default('auto').volatile(),
});

export function apply(ctx, config) {
  const service = new UsageService({
    resolveConfig: () => Object.fromEntries(Object.entries(config).map(([key, field]) => [key, field.get()])),
    resolveKey: async ref => {
      const key = credentialRef(ref || 'SUB2API_ADMIN_KEY');
      const credentials = ctx.get('credentials');
      return credentials ? (await credentials.resolve(key))?.value : launchEnvironmentOf(ctx).get(key)?.value;
    },
  });
  ctx.effect(() => {
    const disposers = createRoutes(service, () => ctx.webServer.getOrigin()).map(route => ctx.webServer.register(route));
    return () => { service.dispose(); for (const dispose of disposers) dispose(); };
  }, 'sub2api-usage-view: local usage routes');
}
