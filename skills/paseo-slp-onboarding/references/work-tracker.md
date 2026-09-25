# Optional beads setup

Read only when Human requests beads setup. Otherwise preserve the toggle;
already-enabled seats follow installed `src/references/work-tracking.md`.

Check `bd version`. Human installs/initializes beads; SLP never installs,
initializes, upgrades or configures it. If absent, report the prerequisite.
For initialization, inspect `bd init --help` and show options that avoid agent
file/git-hook installation; Human chooses and runs them.

Human enables the SLP Manager Work tracker card, which probes bd. Managed seats
then receive the work-tracking pointer. Missing/uninitialized bd is a reported
gap, not a task block. Record the Human-chosen beads root in work-state settings.
Assignment remains authority; beads is evidence, not lifecycle control. Use the
installed policy for probing and actor attribution. Other trackers need no setup
here; use an already-supplied work-state pointer.
