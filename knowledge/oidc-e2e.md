# OIDC E2E Notes

OIDC E2E testing uses a local disposable provider in `e2e/oidc/provider.mjs`; it does not contact a third-party IdP.

The Docker runner is the preferred local and CI path because it supplies Chromium browser dependencies and the Shiplight CLI. The Node harness performs deterministic post-login database assertions through the app's `pg` dependency.

Run it with:

```sh
cd client
npm run test:e2e:oidc
```
