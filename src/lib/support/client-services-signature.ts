/**
 * Standard "Client Services" sign-off appended to outbound support/concierge
 * emails sent from the clients@storyvenue.com identity (ticket replies,
 * Private Clients / venue-contact compose). Shared so the wording and
 * contact channels stay in sync everywhere it's used.
 */
export const CLIENT_SERVICES_PHONE = '740-880-8586';
export const CLIENT_SERVICES_EMAIL = 'clients@storyvenue.com';
export const CLIENT_SERVICES_WEBSITE = 'storyvenue.com';

export const CLIENT_SERVICES_SIGNATURE_HTML = `
<p style="margin:14px 0 0;font-size:13px;line-height:1.7;color:#374151">
  --<br/>
  Client Services<br/>
  Text Us: ${CLIENT_SERVICES_PHONE}<br/>
  Email: <a href="mailto:${CLIENT_SERVICES_EMAIL}" style="color:#374151;text-decoration:underline">${CLIENT_SERVICES_EMAIL}</a><br/>
  Website: <a href="https://${CLIENT_SERVICES_WEBSITE}" style="color:#374151;text-decoration:underline">${CLIENT_SERVICES_WEBSITE}</a>
</p>`;
