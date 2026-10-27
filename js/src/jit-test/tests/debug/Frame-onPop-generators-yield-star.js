// Completion values for sync generators which delegate with yield*.

load(libdir + "asserts.js");
load(libdir + "match.js");
load(libdir + "match-debugger.js");
const { Pattern } = Match;
const { OBJECT_WITH_EXACTLY: X } = Pattern;

const g = newGlobal({ newCompartment: true });
g.eval(`
  var result = { done: false, value: "user" };
  var user = {
    n: 0,
    [Symbol.iterator]() { return this; },
    next() { return this.n++ ? { done: true, value: "userDone" } : result; },
  };
  function* inner() {
    yield "inner";
    return yield* user;
  }
  function* outer() {
    return yield* inner();
  }
`);

const dbg = new Debugger(g);
const completions = [];
dbg.onEnterFrame = frame => {
  if (frame.callee && frame.callee.name === "outer") {
    frame.onPop = completion => {
      completions.push(completion);
    };
  }
};

const it = g.outer();
assertDeepEq(JSON.stringify(it.next()), '{"value":"inner","done":false}');
assertEq(it.next(), g.result);
assertDeepEq(JSON.stringify(it.next()), '{"value":"userDone","done":true}');

const gw = dbg.addDebuggee(g);
Pattern([
  X({ return: new DebuggerObjectPattern("Generator", {}), yield: true, initial: true }),
  X({ return: new DebuggerObjectPattern("Object", { value: "inner", done: false }), yield: true }),
  X({ return: gw.makeDebuggeeValue(g.result), yield: true }),
  X({ return: new DebuggerObjectPattern("Object", { value: "userDone", done: true }) }),
]).assert(completions);
