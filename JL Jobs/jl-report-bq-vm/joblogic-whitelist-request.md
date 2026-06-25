# Email draft — Joblogic Support: whitelist our API IP

**To:** Joblogic Support
**Subject:** API access — please whitelist our static outbound IP

Hi,

We have API credentials (client_credentials / `JL.Api` scope) for our account and want to
start pulling data via the public API. All requests will originate from a single fixed IP:

> **Static outbound IP: `<PASTE THE IP FROM phase1-provision.sh HERE>`**

Please whitelist this IP for our API access so token + data requests are allowed.

Could you also confirm:
1. The production **token endpoint** and **API base URL** for our account
   (we currently have `https://identityserver.joblogic.com/connect/token` and
   `https://api.joblogic.com` — please correct if different).
2. The endpoint(s) that expose **job + visit** data equivalent to our
   "Job and Visit Details" report (report id 8832), and their **pagination** parameters.
3. Any **rate limits** we should respect at an hourly pull cadence.

Thanks,
Joe Segal — UP-FM
</content>
