// |jit-test| --fast-warmup; --no-threads; --async-stacks-capture-debuggee-only

const AsyncGeneratorPrototype =
  Object.getPrototypeOf(async function* () {}).prototype;

function makeClosure() {
  return async function* (x) {
    yield x;
    return x + 1;
  };
}

async function* simpleGen(x) {
  yield x * 2;
  yield x * 2 + 1;
}

async function plain(x) {
  return x + 1;
}

async function awaits(x) {
  let y = await x;
  return y * 2;
}

async function throws(x) {
  throw x;
}

async function withArguments() {
  await null;
  return arguments.length + arguments[0];
}

async function manyLocals(x) {
  let a0 = x, a1 = x + 1, a2 = x + 2, a3 = x + 3, a4 = x + 4, a5 = x + 5;
  let a6 = x + 6, a7 = x + 7, a8 = x + 8, a9 = x + 9, a10 = x + 10;
  let a11 = x + 11, a12 = x + 12, a13 = x + 13, a14 = x + 14, a15 = x + 15;
  await null;
  minorgc();
  return a0 + a1 + a2 + a3 + a4 + a5 + a6 + a7 + a8 + a9 + a10 + a11 + a12 +
         a13 + a14 + a15;
}

let results = [];
function expect(promise, value) {
  assertEq(promise instanceof Promise, true);
  promise.then(v => results.push(["fulfilled", v, "fulfilled", value]),
               e => results.push(["rejected", e, "fulfilled", value]));
}
function expectRejection(promise, reason) {
  assertEq(promise instanceof Promise, true);
  promise.then(v => results.push(["fulfilled", v, "rejected", reason]),
               e => results.push(["rejected", e, "rejected", reason]));
}

for (let i = 0; i < 200; i++) {
  // Async functions.
  expect(plain(i), i + 1);
  expect(awaits(i), i * 2);
  expectRejection(throws(i), i);
  expect(withArguments(i, 2), i + 2);
  expect(manyLocals(i), 16 * i + 120);

  // Every async generator closure has its own prototype object.
  const closure = makeClosure();
  const gen = closure(i);
  assertEq(Object.getPrototypeOf(gen), closure.prototype);
  expect(gen.next().then(r => r.value), i);
  expect(gen.next().then(r => r.value), i + 1);
  expect(gen.next().then(r => r.done), true);

  // Replacing the prototype.
  if (i === 100) {
    simpleGen.prototype = Object.create(AsyncGeneratorPrototype);
  }
  if (i === 150) {
    simpleGen.prototype = 1;
  }
  const s = simpleGen(i);
  if (i >= 150) {
    assertEq(Object.getPrototypeOf(s), AsyncGeneratorPrototype);
  } else {
    assertEq(Object.getPrototypeOf(s), simpleGen.prototype);
  }
  if (i % 50 === 0) {
    gc();
  }
  expect(s.next().then(r => r.value), i * 2);
  expect(s.next().then(r => r.value), i * 2 + 1);

  // Returning from a generator that hasn't started.
  expect(simpleGen(i).return(i).then(r => r.value), i);

  drainJobQueue();
}

assertEq(results.length, 200 * 11);
for (let [actualState, actual, expectedState, expected] of results) {
  assertEq(actualState, expectedState);
  assertEq(actual, expected);
}

// Promises created by async functions need an allocation site whenever async
// stack capture applies to the realm, including after the function has been
// JIT-compiled and the stub attached. Each case turns on one of the conditions
// in JS::IsAsyncStackCaptureEnabledForRealm after warming up, and turns it off
// again before inspecting the promises.
function checkAsyncStackCapture(name, enable, disable) {
  const g = newGlobal({newCompartment: true});
  g.eval(`
    async function f() {}
    var promises = [];
    function run(n) {
      for (let i = 0; i < n; i++) {
        promises.push(f());
      }
    }
    run(200);
  `);
  const dbg = new Debugger();
  enable(dbg, g);
  g.promises.length = 0;
  g.run(10);
  disable(dbg, g);

  const gw = dbg.addDebuggee(g);
  assertEq(g.promises.length, 10);
  for (const p of g.promises) {
    assertEq(gw.makeDebuggeeValue(p).promiseAllocationSite !== null, true,
             name);
  }
}

// The realm is a debuggee.
checkAsyncStackCapture("debuggee", (dbg, g) => dbg.addDebuggee(g),
                       (dbg, g) => dbg.removeDebuggee(g));

// The realm has async stack capturing enabled but isn't a debuggee.
checkAsyncStackCapture("enableAsyncStack", (dbg, g) => {
  dbg.addDebuggee(g);
  dbg.enableAsyncStack(g);
  dbg.removeDebuggee(g);
}, (dbg, g) => dbg.disableAsyncStack(g));

// The context options capture async stacks everywhere.
checkAsyncStackCapture("options", () => setAsyncStackOptions(true, false),
                       () => setAsyncStackOptions(true, true));
