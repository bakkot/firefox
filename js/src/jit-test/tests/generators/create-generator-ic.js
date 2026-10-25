// |jit-test| --fast-warmup; --no-threads

const GeneratorPrototype = Object.getPrototypeOf(function* () {}).prototype;

function makeClosure() {
  return function* (x) {
    yield x;
    return x + 1;
  };
}

function* withArguments() {
  yield arguments.length;
  yield arguments[0];
}

function* manyLocals(x) {
  let a0 = x, a1 = x + 1, a2 = x + 2, a3 = x + 3, a4 = x + 4, a5 = x + 5;
  let a6 = x + 6, a7 = x + 7, a8 = x + 8, a9 = x + 9, a10 = x + 10;
  let a11 = x + 11, a12 = x + 12, a13 = x + 13, a14 = x + 14, a15 = x + 15;
  yield a0 + a1 + a2 + a3 + a4 + a5 + a6 + a7;
  yield a8 + a9 + a10 + a11 + a12 + a13 + a14 + a15;
}

function* simple(x) {
  let y = x * 2;
  yield y;
  yield y + 1;
}

for (let i = 0; i < 200; i++) {
  // Every closure has its own prototype object.
  const closure = makeClosure();
  const gen = closure(i);
  assertEq(Object.getPrototypeOf(gen), closure.prototype);
  assertEq(gen.next().value, i);
  assertEq(gen.next().value, i + 1);

  // Replacing the prototype.
  if (i === 100) {
    simple.prototype = Object.create(GeneratorPrototype);
  }
  if (i === 150) {
    simple.prototype = 1;
  }
  const s = simple(i);
  if (i >= 150) {
    assertEq(Object.getPrototypeOf(s), GeneratorPrototype);
  } else {
    assertEq(Object.getPrototypeOf(s), simple.prototype);
  }
  assertEq(s.next().value, i * 2);
  if (i % 50 === 0) {
    gc();
  }
  assertEq(s.next().value, i * 2 + 1);
  assertEq(s.next().done, true);

  const a = withArguments(i, 2);
  assertEq(a.next().value, 2);
  assertEq(a.next().value, i);

  const m = manyLocals(i);
  assertEq(m.next().value, 8 * i + 28);
  minorgc();
  assertEq(m.next().value, 8 * i + 92);

  // Self-hosted generators use the default prototype.
  const mapped = [i, i + 1].values().map(v => v * 3);
  assertEq(mapped.next().value, i * 3);
  assertEq(mapped.next().value, i * 3 + 3);
}

// Generator creation in debuggee frames must notify the debugger, so that the
// generator's later resumptions reuse the same Debugger.Frame.
const g = newGlobal({newCompartment: true});
g.eval(`
  function* gen() {
    yield 1;
    yield 2;
  }
  function run() {
    const it = gen();
    it.next();
    it.next();
  }
  for (let i = 0; i < 200; i++) {
    run();
  }
`);
const dbg = Debugger(g);
let frames = [];
dbg.onEnterFrame = frame => {
  if (frame.callee && frame.callee.name === "gen") {
    frames.push(frame);
  }
};
g.run();
assertEq(frames.length, 3);
assertEq(frames[0], frames[1]);
assertEq(frames[1], frames[2]);
