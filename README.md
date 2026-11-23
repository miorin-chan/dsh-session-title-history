# Session title history

[简体中文](README.zh.md)

Open the session’s **⋯** menu and choose **Title history** to see the original title,
later edits, their timestamps, and which titles were generated automatically.
Click the pencil beside a past title to edit and save that history entry in place.
Click **↗** to make the displayed text current again.
DSH records the restore as a manual rename.
These actions appear while the current connection may rename the session.
An Agent in the conversation can list, edit, or restore past titles through the `session_title_history` tool.

For DeepSeek Harness `0.2.2-rc.5` on Desktop and Web.
Enable **Session title history** in **Session Atlas**.
For a standalone install from source, run `npm ci` in the checkout to build the plugin,
then select that directory in **Plugins → Add plugin**.
Use one installation route per profile because both use the same plugin row.

History includes title events still present in the session log, including writes made before installation.
A manually requested regeneration is labeled by its generator.
DSH uses its rename API to append a number when it forks a session, so that entry also appears as **Manual edit**.
[Project documentation](docs/README.md)
