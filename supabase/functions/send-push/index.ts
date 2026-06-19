// send-push — delivers due `scheduled_pushes` rows via Web Push (Deno Edge Fn).
//
// Invoked on a schedule (pg_cron + pg_net; see migration 0005). Uses the service
// role to read across users — it is the only place that does, and it never trusts
// client input. It performs no schedule math: the client already computed
// `fire_at`; this function just finds what is due and delivers it.
//
// Required function secrets (set with `supabase secrets set …`):
//   SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY  (provided automatically on deploy)
//   VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY      (your keypair; private key is secret)
//   VAPID_SUBJECT                            (optional, e.g. mailto:you@example.com)

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import webpush from 'https://esm.sh/web-push@3.6.7';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const VAPID_PUBLIC_KEY = Deno.env.get('VAPID_PUBLIC_KEY')!;
const VAPID_PRIVATE_KEY = Deno.env.get('VAPID_PRIVATE_KEY')!;
const VAPID_SUBJECT = Deno.env.get('VAPID_SUBJECT') ?? 'mailto:admin@steadydose.app';

webpush.setVapidDetails(VAPID_SUBJECT, VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY);

interface ScheduledPush {
  user_id: string;
  id: string;
  title: string;
  body: string;
  url: string;
  can_take: boolean;
}
interface Subscription {
  endpoint: string;
  p256dh: string;
  auth: string;
}

Deno.serve(async () => {
  const supabase = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);
  const now = Date.now();

  const { data: due, error } = await supabase
    .from('scheduled_pushes')
    .select('user_id, id, title, body, url, can_take')
    .eq('sent', false)
    .lte('fire_at', now)
    .limit(500);
  if (error) return new Response(error.message, { status: 500 });

  let delivered = 0;
  for (const row of (due ?? []) as ScheduledPush[]) {
    const { data: subs } = await supabase
      .from('push_subscriptions')
      .select('endpoint, p256dh, auth')
      .eq('user_id', row.user_id);

    const payload = JSON.stringify({
      title: row.title,
      body: row.body,
      tag: row.id,
      url: row.url,
      canTake: row.can_take,
    });

    for (const sub of (subs ?? []) as Subscription[]) {
      try {
        await webpush.sendNotification(
          { endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } },
          payload,
        );
        delivered++;
      } catch (e) {
        // 404/410 → the subscription is gone; prune it so we stop trying.
        const status = (e as { statusCode?: number }).statusCode;
        if (status === 404 || status === 410) {
          await supabase.from('push_subscriptions').delete().eq('endpoint', sub.endpoint);
        }
      }
    }

    // Mark sent regardless of per-subscription failures so we never re-deliver.
    await supabase
      .from('scheduled_pushes')
      .update({ sent: true })
      .eq('user_id', row.user_id)
      .eq('id', row.id);
  }

  return new Response(JSON.stringify({ processed: due?.length ?? 0, delivered }), {
    headers: { 'content-type': 'application/json' },
  });
});
