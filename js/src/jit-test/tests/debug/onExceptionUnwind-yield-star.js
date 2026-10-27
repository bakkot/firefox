// isInCatchScope ignores the synthetic catch block that yield* uses to close
// inner generators.

load(libdir + "asserts.js");

var g = newGlobal({ newCompartment: true });
var dbg = Debugger(g);
var hits = [];
dbg.onExceptionUnwind = function (frame, exc) {
  if (frame.callee.name !== "inner") {
    return;
  }
  var outer = frame.older;
  // Skip the self-hosted %GeneratorPrototype%.next frame, if any.
  while (outer.callee.name !== "outer") {
    outer = outer.older;
  }
  hits.push(outer.script.isInCatchScope(outer.offset));
};

g.eval(`
  function* inner() {
    yield 1;
    throw 16;
  }
  function* outer(caught) {
    if (caught) {
      try {
        yield* inner();
      } catch (e) {
        return "caught";
      }
    }
    yield* inner();
  }
`);

var it = g.outer(false);
it.next();
assertThrowsValue(() => it.next(), 16);

it = g.outer(true);
it.next();
assertEq(JSON.stringify(it.next()), '{"value":"caught","done":true}');

assertEq(hits.join(), "false,true");
