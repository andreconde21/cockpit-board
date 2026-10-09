import { test } from "node:test";
import assert from "node:assert/strict";
import { mergeMachines, parseHerdrMachines, parseSshConfigHosts, resolveMachine } from "../src/agent/machines";
import { DEFAULT_SETTINGS } from "../src/constants";

test("ssh config hosts skip patterns", () => {
  const cfg = "Host dev dev-central\n  HostName 1.2.3.4\nHost *\n  ForwardAgent no\nhost prod !bad\nMatch host x\nHost dev\n";
  assert.deepEqual(parseSshConfigHosts(cfg), ["dev", "dev-central", "prod"]);
});

test("herdr machine list in several shapes", () => {
  assert.deepEqual(parseHerdrMachines("[]"), []);
  assert.deepEqual(parseHerdrMachines('[{"label":"dev","destination":"root@dev","enabled":true},{"label":"off","enabled":false}]'),
    [{ label: "dev", destination: "root@dev" }]);
  assert.deepEqual(parseHerdrMachines('{"result":{"machines":[{"id":"m1","name":"lap"}]}}'), [{ label: "lap" }]);
  assert.deepEqual(parseHerdrMachines("not json"), []);
});

test("real herdr 0.9.3 output (laptop): target is the SSH host, no duplicate entry", () => {
  const json = '[{"id":"1fce1c7112e854eb6cd182d9e839dd33","label":"dev","target":"development-central","session":"default","enabled":true,"selected":false}]';
  const herdr = parseHerdrMachines(json);
  assert.deepEqual(herdr, [{ label: "dev", destination: "development-central" }]);
  const ms = mergeMachines(herdr, ["development-central", "production-central"], []);
  assert.deepEqual(ms.map((m) => [m.name, m.sources.join("+")]), [["dev", "herdr+ssh"], ["production-central", "ssh"]]);
  assert.equal(resolveMachine(ms[0], structuredClone(DEFAULT_SETTINGS)).sshTarget, "development-central");
});

test("merge by name and resolve defaults", () => {
  const ms = mergeMachines([{ label: "dev", destination: "root@1.2.3.4" }], ["dev", "prod"], ["box", "prod"]);
  assert.deepEqual(ms.map((m) => [m.name, m.sources.join("+")]), [["dev", "herdr+ssh"], ["prod", "ssh+manual"], ["box", "manual"]]);
  const s = structuredClone(DEFAULT_SETTINGS);
  const dev = resolveMachine(ms[0], s);
  assert.equal(dev.sshTarget, "root@1.2.3.4");
  assert.equal(dev.sessionMode, "herdr");
  assert.equal(dev.delivery, "upload");
  const prod = resolveMachine(ms[1], s);
  assert.equal(prod.sshTarget, "prod");
  assert.equal(prod.sessionMode, "terminal");
  s.machineOverrides.prod = { sshTarget: "", cwd: "~/p", agentId: "", sessionMode: "", delivery: "", sharedLocal: "~/S", sharedRemote: "/srv/s", hidden: false };
  assert.equal(resolveMachine(ms[1], s).delivery, "shared");
  s.machineOverrides.box = { sshTarget: "", cwd: "", agentId: "", sessionMode: "", delivery: "shared", sharedLocal: "", sharedRemote: "", hidden: false };
  assert.equal(resolveMachine(ms[2], s).delivery, "upload", "shared without folders falls back");
});
