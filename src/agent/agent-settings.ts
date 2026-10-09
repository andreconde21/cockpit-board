import { Notice, Platform, Setting } from "obsidian";
import type { SettingDefinition, SettingDefinitionItem, SettingDefinitionPage } from "obsidian";
import type CockpitBoardPlugin from "../CockpitBoardPlugin";
import { AGENT_PRESETS } from "../constants";
import type { AgentProfile, CardDelivery, MachineOverride, SessionMode } from "../types";
import { loginEnv, nodeApis, runProcess } from "../node";
import { TERMINAL_PRESETS, osKey } from "./launcher";
import { EMPTY_OVERRIDE, discoverAllMachines, resolveMachine, type Machine } from "./machines";

/**
 * The "Agents" part of the settings tab: launcher switch, agent profiles,
 * this computer's defaults, and machines (discovered, with optional
 * overrides). Desktop only.
 */
export class AgentSettings {
  private machines: Machine[] | null = null;
  private discovering = false;

  constructor(
    private plugin: CockpitBoardPlugin,
    private save: () => void,
    private saveAndRefresh: () => Promise<void>,
    private refresh: () => void,
  ) {}

  private get s() { return this.plugin.settings; }

  private text(name: string, desc: string, get: () => string, set: (v: string) => void, placeholder = ""): SettingDefinition {
    return {
      name, desc,
      render: (setting: Setting) => {
        setting.addText((t) => t.setPlaceholder(placeholder).setValue(get()).onChange((v) => { set(v); this.save(); }));
      },
    };
  }

  private toggle(name: string, desc: string, get: () => boolean, set: (v: boolean) => void, refresh = false): SettingDefinition {
    return {
      name, desc,
      render: (setting: Setting) => {
        setting.addToggle((t) => t.setValue(get()).onChange((v) => {
          set(v);
          if (refresh) void this.saveAndRefresh();
          else this.save();
        }));
      },
    };
  }

  private sessionDropdown(name: string, desc: string, get: () => SessionMode | "", set: (v: SessionMode | "") => void, auto: string): SettingDefinition {
    return {
      name, desc,
      render: (setting: Setting) => {
        setting.addDropdown((d) => d
          .addOption("", auto)
          .addOption("herdr", "Workspace in herdr")
          .addOption("terminal", "New terminal")
          .addOption("tmux", "Window in tmux")
          .setValue(get())
          .onChange((v) => { set(v as SessionMode | ""); this.save(); }));
      },
    };
  }

  items(): SettingDefinitionItem[] {
    if (!Platform.isDesktopApp) return [];
    const s = this.s;
    const on = () => s.agentLauncherEnabled;
    return [
      {
        type: "group",
        heading: "Agents",
        items: [
          {
            name: "What this does",
            desc: "Adds \"Start agent\" to card menus: it starts a coding agent (Claude Code, Codex...) with the card as its task, on this computer or on a machine you reach over SSH or herdr. It runs programs on your computer and over SSH, only when you click start.",
          },
          this.toggle("Enable agent launcher", "Off: no agent menu items, and the plugin never starts a program.",
            () => s.agentLauncherEnabled, (v) => { s.agentLauncherEnabled = v; }, true),
          {
            name: "Default agent",
            desc: "Used by \"Start <agent>\" in the card menu, and preselected in the dialog.",
            visible: on,
            render: (setting: Setting) => {
              setting.addDropdown((d) => {
                for (const a of s.agentProfiles) d.addOption(a.id, a.name || a.command || a.id);
                d.setValue(s.defaultAgentId).onChange((v) => { s.defaultAgentId = v; this.save(); });
              });
            },
          },
          {
            name: "Prompt template",
            desc: "Placeholders: {{context}}, {{id}}, {{title}}, {{path}}, {{absPath}}, {{cardFile}}, {{boardLink}}, {{project}}, {{labels}}.",
            visible: on,
            render: (setting: Setting) => {
              setting.addTextArea((t) => {
                t.inputEl.rows = 5;
                t.inputEl.addClass("cockpit-settings-template");
                t.setValue(s.agentPromptTemplate).onChange((v) => { s.agentPromptTemplate = v; this.save(); });
              });
            },
          },
          { ...this.toggle("Record launches on the card", "Adds a line to the card's agent_runs property each time an agent starts.",
            () => s.agentRecordRuns, (v) => { s.agentRecordRuns = v; }), visible: on },
        ],
      },
      this.profilesList(),
      this.localGroup(),
      this.machinesList(),
    ];
  }

  // ── Agent profiles ──

  private profilesList(): SettingDefinitionItem {
    const s = this.s;
    return {
      type: "list",
      heading: "Agent profiles",
      visible: () => s.agentLauncherEnabled,
      emptyState: "No agents. Add one.",
      items: s.agentProfiles.map((p) => this.profilePage(p)),
      onDelete: (index) => {
        if (s.agentProfiles.length <= 1) { new Notice("Keep at least one agent."); return; }
        const [gone] = s.agentProfiles.splice(index, 1);
        if (s.defaultAgentId === gone.id) s.defaultAgentId = s.agentProfiles[0].id;
        void this.saveAndRefresh();
      },
      addItem: {
        name: "Add agent",
        action: () => {
          s.agentProfiles.push({ id: `agent-${Date.now()}`, name: "New agent", command: "", args: "", herdrKind: "", promptTemplate: "" });
          void this.saveAndRefresh();
        },
      },
    };
  }

  private profilePage(p: AgentProfile): SettingDefinitionPage {
    return {
      type: "page",
      name: p.name || p.command || "Agent",
      desc: [p.command || "no command", p.args].filter(Boolean).join(" "),
      displayValue: () => (this.s.defaultAgentId === p.id ? "default" : ""),
      items: [
        {
          name: "Preset",
          desc: "Fills in the command and herdr kind. Presets never add permission-bypass flags.",
          render: (setting: Setting) => {
            setting.addDropdown((d) => {
              d.addOption("", "Choose...");
              for (const pr of AGENT_PRESETS) d.addOption(pr.name, pr.name);
              d.onChange((v) => {
                const pr = AGENT_PRESETS.find((x) => x.name === v);
                if (!pr) return;
                p.name = pr.name === "Custom" ? p.name : pr.name;
                p.command = pr.command;
                p.herdrKind = pr.herdrKind;
                void this.saveAndRefresh();
              });
            });
          },
        },
        this.text("Name", "Shown in menus.", () => p.name, (v) => { p.name = v; }, "Claude"),
        this.text("Command", "Executable name or full path.", () => p.command, (v) => { p.command = v; }, "claude"),
        this.text("Arguments", "Extra arguments, separated by spaces. Use double quotes to group.", () => p.args, (v) => { p.args = v; }, "--model opus"),
        this.text("herdr kind", "herdr's name for this agent (claude, codex, gemini...). herdr then runs its own executable for that kind. Empty: herdr runs the command above in the workspace.",
          () => p.herdrKind, (v) => { p.herdrKind = v.trim(); }, "claude"),
        {
          name: "Prompt template",
          desc: "Empty uses the template from the agents section.",
          render: (setting: Setting) => {
            setting.addTextArea((t) => {
              t.inputEl.rows = 4;
              t.inputEl.addClass("cockpit-settings-template");
              t.setValue(p.promptTemplate).onChange((v) => { p.promptTemplate = v; this.save(); });
            });
          },
        },
      ],
    };
  }

  // ── This computer ──

  private localGroup(): SettingDefinitionItem {
    const s = this.s;
    const l = s.agentLocal;
    const os = osKey(nodeApis()?.process.platform ?? "linux");
    return {
      type: "group",
      heading: "This computer",
      visible: () => s.agentLauncherEnabled,
      items: [
        this.text("Working folder", "Where local agents start. Empty: the vault folder. A card can set its own with an agent_cwd property.",
          () => l.cwd, (v) => { l.cwd = v.trim(); }, "~/Projects"),
        this.sessionDropdown("Session", "How a local agent opens.", () => l.sessionMode, (v) => { l.sessionMode = v; }, "herdr if installed, else new terminal"),
        {
          name: "Terminal",
          desc: "Command that opens a terminal; {script} is the launch script Cockpit writes. Empty: the first one found on this computer.",
          render: (setting: Setting) => {
            setting.addDropdown((d) => {
              d.addOption("", "Choose a preset...");
              for (const p of TERMINAL_PRESETS[os]) d.addOption(p.command, p.name);
              d.onChange((v) => { if (v) { l.terminalCommand = v; void this.saveAndRefresh(); } });
            });
            setting.addText((t) => t.setPlaceholder("Automatic").setValue(l.terminalCommand)
              .onChange((v) => { l.terminalCommand = v; this.save(); }));
          },
        },
        this.text("tmux session", "Agents open as windows in this session.", () => l.tmuxSession, (v) => { l.tmuxSession = v.trim(); }, "cockpit"),
        this.toggle("Open a terminal on the tmux session", "After adding the window, open a terminal attached to the session if none is.",
          () => l.attachTmux, (v) => { l.attachTmux = v; }),
        this.text("herdr path", "Empty: found on your login PATH.", () => l.herdrPath, (v) => { l.herdrPath = v.trim(); }, "herdr"),
        this.text("tmux path", "Empty: found on your login PATH.", () => l.tmuxPath, (v) => { l.tmuxPath = v.trim(); }, "tmux"),
        this.text("SSH path", "Empty: found on your login PATH.", () => l.sshPath, (v) => { l.sshPath = v.trim(); }, "ssh"),
      ],
    };
  }

  // ── Machines ──

  private discover(): void {
    const node = nodeApis();
    if (!node || this.discovering) return;
    this.discovering = true;
    void discoverAllMachines(node, this.s)
      .then((m) => { this.machines = m; })
      .catch(() => { this.machines = []; })
      .finally(() => { this.discovering = false; this.refresh(); });
  }

  private machinesList(): SettingDefinitionItem {
    const s = this.s;
    if (this.machines === null) this.discover();
    const machines = this.machines ?? [];
    return {
      type: "list",
      heading: "Machines",
      visible: () => s.agentLauncherEnabled,
      emptyState: this.machines === null
        ? "Looking for machines..."
        : "None found. Machines come from herdr (herdr machine list) and your SSH config; add one by hand with its SSH alias.",
      items: [
        {
          name: "Where machines come from",
          desc: "herdr's saved machines and the hosts in your SSH config appear here by themselves. Everything below is optional: open a machine to set its folder, agent, session or shared folder.",
        },
        ...machines.map((m) => this.machinePage(m)),
      ],
      addItem: {
        name: "Add machine",
        action: () => {
          let name = "new-machine";
          for (let n = 2; s.manualMachines.includes(name); n++) name = `new-machine-${n}`;
          s.manualMachines.push(name);
          this.machines = null;
          void this.saveAndRefresh();
        },
      },
      extraButtons: [
        (b) => b.setIcon("refresh-cw").setTooltip("Look for machines again").onClick(() => {
          this.machines = null;
          this.refresh();
        }),
      ],
    };
  }

  private override(name: string): MachineOverride {
    const o = this.s.machineOverrides[name] ?? { ...EMPTY_OVERRIDE };
    this.s.machineOverrides[name] = o;
    return o;
  }

  private machinePage(m: Machine): SettingDefinitionPage {
    const s = this.s;
    const resolved = resolveMachine(m, s);
    const o = (): MachineOverride => this.override(m.name);
    const manual = m.sources.includes("manual");
    return {
      type: "page",
      name: m.name,
      desc: `From ${m.sources.join(" + ")}`,
      displayValue: () => (s.machineOverrides[m.name]?.hidden ? "hidden" : resolved.sessionMode),
      items: [
        ...(manual ? [{
          name: "SSH alias",
          desc: "The name you use with ssh (from your SSH config), or user@host.",
          render: (setting: Setting) => {
            setting.addText((t) => {
              t.setValue(m.name);
              t.inputEl.addEventListener("change", () => {
                const next = t.getValue().trim();
                if (!next || next === m.name || s.manualMachines.includes(next)) return;
                s.manualMachines = s.manualMachines.map((x) => (x === m.name ? next : x));
                if (s.machineOverrides[m.name]) {
                  s.machineOverrides[next] = s.machineOverrides[m.name];
                  delete s.machineOverrides[m.name];
                }
                this.machines = null;
                void this.saveAndRefresh();
              });
            });
          },
        } as SettingDefinition] : []),
        this.text("SSH target", `Empty: ${m.herdrDestination || m.name}.`, () => o().sshTarget, (v) => { o().sshTarget = v.trim(); }, m.herdrDestination || m.name),
        this.text("Working folder", "On that machine. Empty: home. Absolute paths are safest with herdr.", () => o().cwd, (v) => { o().cwd = v.trim(); }, "~/Projects"),
        {
          name: "Agent",
          render: (setting: Setting) => {
            setting.addDropdown((d) => {
              d.addOption("", "Default agent");
              for (const a of s.agentProfiles) d.addOption(a.id, a.name || a.command);
              d.setValue(o().agentId).onChange((v) => { o().agentId = v; this.save(); });
            });
          },
        },
        this.sessionDropdown("Session", "", () => o().sessionMode, (v) => { o().sessionMode = v; },
          m.herdrLabel ? "herdr (default)" : "New terminal (default)"),
        {
          name: "Card file",
          desc: "How the agent there gets the card. Default: shared folder when set, else upload over SSH.",
          render: (setting: Setting) => {
            setting.addDropdown((d) => d
              .addOption("", "Default")
              .addOption("inline", "In the prompt")
              .addOption("upload", "Upload over SSH")
              .addOption("shared", "Copy to shared folder")
              .setValue(o().delivery)
              .onChange((v) => { o().delivery = v as CardDelivery | ""; this.save(); }));
          },
        },
        this.text("Shared folder on this computer", "A folder both computers see (Syncthing, Dropbox, sshfs...).",
          () => o().sharedLocal, (v) => { o().sharedLocal = v.trim(); }, "~/Shared/dev"),
        this.text("Shared folder on the machine", "The same folder as that machine sees it.",
          () => o().sharedRemote, (v) => { o().sharedRemote = v.trim(); }, "/srv/shared"),
        this.toggle("Hide from the launcher", "Keep it out of the \"Where\" list.", () => o().hidden, (v) => { o().hidden = v; }),
        {
          name: "Test connection",
          desc: "Checks SSH without a password prompt, and herdr for herdr machines.",
          render: (setting: Setting) => {
            setting.addButton((b) => b.setButtonText("Test").onClick(() => { void this.test(m); }));
          },
        },
        ...(manual ? [{
          name: "Remove this machine",
          render: (setting: Setting) => {
            setting.addButton((b) => b.setButtonText("Remove").setDestructive().onClick(() => {
              s.manualMachines = s.manualMachines.filter((x) => x !== m.name);
              delete s.machineOverrides[m.name];
              this.machines = null;
              void this.saveAndRefresh();
            }));
          },
        } as SettingDefinition] : []),
      ],
    };
  }

  private async test(m: Machine): Promise<void> {
    const node = nodeApis();
    if (!node) return;
    const env = await loginEnv(node);
    const r = resolveMachine(m, this.s);
    const lines: string[] = [];
    const ssh = await runProcess(node, this.s.agentLocal.sshPath || "ssh",
      ["-o", "BatchMode=yes", "-o", "ConnectTimeout=10", r.sshTarget, "true"], { env, timeoutMs: 20000 });
    lines.push(ssh.code === 0 ? `SSH to ${r.sshTarget}: ok` : `SSH to ${r.sshTarget}: failed (${(ssh.stderr || ssh.stdout).trim().split("\n")[0]})`);
    if (m.herdrLabel) {
      const h = await runProcess(node, this.s.agentLocal.herdrPath || "herdr", ["machine", "status", m.herdrLabel, "--json"], { env, timeoutMs: 20000 });
      lines.push(h.code === 0 ? `herdr ${m.herdrLabel}: ok` : `herdr ${m.herdrLabel}: failed (${(h.stderr || h.stdout).trim().split("\n")[0]})`);
    }
    new Notice(lines.join("\n"), 10000);
  }
}
