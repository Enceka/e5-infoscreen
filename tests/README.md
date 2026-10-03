These tests use a disposable OpenWrt container and mocked browser requests.
They never send modem call-control commands. Do not run the API fixture test
on a live E5; it creates a temporary installed test plugin.

Run `notifications.uc` with a writable copy of
`root/usr/share/e5-infoscreen` at `/usr/share/e5-infoscreen`, and copy
`tests/fixtures/fixture` into its `www/plugins/fixture` directory first.
Use an OpenWrt image with ucode/fs/uci/ubus modules.

For the browser test, install Playwright in a separate tool directory and run
`E5_PLAYWRIGHT=/path/to/playwright node tests/notifications-ui.cjs`.
All requests are intercepted at `screen.test`; the test never connects to E5.
