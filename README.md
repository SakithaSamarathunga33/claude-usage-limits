# Claude usage limits
![claude-usage-limits, a Claude Code plugin that tracks your Claude plan usage with progress bars and reset timers](docs/cover.png)

See how much of your Claude plan you have used without leaving Claude Code. This plugin shows your **5-hour session limit** and your **weekly limit** as progress bars right above the prompt box, with the time left until each one resets.

![Usage bars in dark and light themes, at low, high and full usage](docs/preview.png)

*A preview of the bars in dark and light themes. The figures are examples.*

- Bars turn **amber at 75%** and **red at 90%**.
- The figures update as you use Claude, and the countdown refreshes every minute.
- A new session shows your last known figures straight away, then switches to live ones after its first reply.
- It works in every project once installed.

## What you need

- A **Claude Pro or Max** subscription. API-key logins have no plan limits, so there is nothing to show.
- **Claude Code**, signed in. Tested with versions 2.1.316 and 2.1.319.
- **Git**, which Claude Code uses to download the plugin.

Where you see it:

| Where you use Claude Code | What you get |
| --- | --- |
| VS Code extension | Progress bars above the prompt |
| Desktop app | Progress bars above the prompt |
| Terminal | A one-line summary: `5h ◑ 42% ↻ 2h 14m │ Week ◔ 18% ↻ 2d 3h` |

## Install on Windows

1. Open **PowerShell**. In VS Code you can use **Terminal > New Terminal**.
2. Check that Claude Code and Git are installed:

   ```powershell
   claude --version
   git --version
   ```

   If `git` is not found, install it from [git-scm.com](https://git-scm.com/download/win), then open a new PowerShell window.

3. Install the plugin:

   ```powershell
   claude plugin install usage-limits --marketplace SakithaSamarathunga33/claude-usage-limits
   ```

4. Open a new Claude session. In VS Code, you can also press `Ctrl+Shift+P` and run **Developer: Reload Window**.

## Install on Mac

1. Open **Terminal**. In VS Code you can use **Terminal > New Terminal**.
2. Check that Claude Code and Git are installed:

   ```bash
   claude --version
   git --version
   ```

   If your Mac offers to install the developer tools when you run `git`, accept and wait for it to finish.

3. Install the plugin:

   ```bash
   claude plugin install usage-limits --marketplace SakithaSamarathunga33/claude-usage-limits
   ```

4. Open a new Claude session. In VS Code, you can also press `Cmd+Shift+P` and run **Developer: Reload Window**.

## Install from inside Claude Code

In a terminal session of Claude Code, on either system, type this at the prompt:

```text
/plugin install usage-limits --marketplace SakithaSamarathunga33/claude-usage-limits
```

Answer `y` to add the marketplace, then press Enter to install it for your user account.

## Using it

The bars appear on their own after your first reply on a new computer. After that they show as soon as you open a session.

Type `/limits` in Claude Code for a more detailed view.

## Update

Run these on Windows or Mac:

```bash
claude plugin marketplace update claude-usage-limits
claude plugin update usage-limits@claude-usage-limits
```

Then open a new Claude session.

## Uninstall

```bash
claude plugin uninstall usage-limits@claude-usage-limits
claude plugin marketplace remove claude-usage-limits
```

## Troubleshooting

| What you see | What to do |
| --- | --- |
| Nothing shows after installing | Open a new session and send one message. The first figures arrive with the first reply. |
| A line of text instead of bars | Your version of Claude Code is not drawing the bars there. Update Claude Code. The text line shows the same figures. |
| `/limits` says "No usage-limit reading yet" | Send one message first. If it stays, check that you are signed in with a Pro or Max plan and not an API key. |
| `/limits` is an unknown command | Update Claude Code, then open a new session. |
| The install fails to download | Check that `git --version` works, then try again. |
| A limit shows "reset" | That limit has reset. The new figure arrives with your next reply. |

## Privacy

The plugin only reads the usage figures Claude Code already has. It makes no network requests of its own and does not touch your login. The last reading is saved in Claude Code's own plugin storage on your computer, so a new session has something to show.

## Good to know

This plugin uses Claude Code's early-access plugin API, which may change between releases. If an update stops it from working, check this repository for a newer version.

## Development

Run the tests and checks from the repository folder:

```bash
claude plugin test .
claude plugin validate .
```
