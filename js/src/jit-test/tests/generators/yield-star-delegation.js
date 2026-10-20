// yield* resumes inner generators directly. Check that this is unobservable.

load(libdir + "asserts.js");

function results(it, sends = []) {
  var out = [];
  for (var i = 0; ; i++) {
    var r = it.next(sends[i]);
    out.push(JSON.stringify(r));
    if (r.done) {
      return out.join();
    }
  }
}

for (var i = 0; i < 100; i++) {
  // Received values and return values.
  function* inner() { var r = yield 1; yield r; return "ret"; }
  function* outer() { var v = yield* inner(); yield v; var w = yield* [7, 8]; yield w; }
  assertEq(results(outer(), [undefined, "sent"]),
           '{"value":1,"done":false},{"value":"sent","done":false},' +
           '{"value":"ret","done":false},{"value":7,"done":false},' +
           '{"value":8,"done":false},{"done":false},{"done":true}');

  // Deep delegation.
  function* deep(d) { if (d) return yield* deep(d - 1); yield 1; yield 2; return "deep"; }
  assertEq(results(deep(5)),
           '{"value":1,"done":false},{"value":2,"done":false},{"value":"deep","done":true}');

  // Delegation to empty generators.
  function* empty() { return i; }
  function* manyEmpty() { var s = 0; for (var j = 0; j < 5; j++) s += yield* empty(); return s; }
  assertEq(results(manyEmpty()), '{"value":' + 5 * i + ',"done":true}');

  // User iterator results are read in spec order, and their identity is
  // preserved through several levels of yield*.
  var log = [];
  var userIter = {
    k: 0,
    [Symbol.iterator]() { return this; },
    next() {
      var k = this.k++;
      return {
        get done() { log.push("d" + k); return k >= 2; },
        get value() { log.push("v" + k); return k; },
      };
    },
  };
  function* d1() { return yield* userIter; }
  function* d2() { return yield* d1(); }
  var it = d2();
  var r0 = it.next();
  assertEq(log.join(), "d0,d0");
  assertEq(r0.value, 0);
  assertEq(log.join(), "d0,d0,v0");
  it.next();
  var r2 = it.next();
  assertEq(r2.done, true);
  assertEq(r2.value, 2);
  assertEq(log.join(), "d0,d0,v0,d1,d1,d2,v2");

  var obj = { done: false, value: 1 };
  var same = {
    n: 0,
    [Symbol.iterator]() { return this; },
    next() { return this.n++ ? { done: true, value: "end" } : obj; },
  };
  function* e1() { return yield* same; }
  function* e2() { return yield* e1(); }
  var it2 = e2();
  assertEq(it2.next(), obj);
  assertEq(JSON.stringify(it2.next()), '{"value":"end","done":true}');

  // throw and return are delegated.
  var finallyLog = [];
  function* t1() {
    try { yield 1; } catch (e) { yield "caught " + e; } finally { finallyLog.push("t1"); }
  }
  function* t2() { yield* t1(); }
  var it3 = t2();
  it3.next();
  assertEq(JSON.stringify(it3.throw("x")), '{"value":"caught x","done":false}');
  assertEq(JSON.stringify(it3.next()), '{"done":true}');
  var it4 = t2();
  it4.next();
  assertEq(JSON.stringify(it4.return("r")), '{"value":"r","done":true}');
  assertEq(finallyLog.join(), "t1,t1");

  // Exceptions from the inner generator close it.
  function* bad() { yield 1; throw new Error("boom"); }
  var b = bad();
  var wb = (function*() { yield* b; })();
  wb.next();
  assertThrowsInstanceOf(() => wb.next(), Error);
  assertEq(JSON.stringify(b.next()), '{"done":true}');

  // Delegating to a running generator throws.
  var self;
  function* selfDelegate() { yield* self; }
  self = selfDelegate();
  assertThrowsInstanceOf(() => self.next(), TypeError);

  // Delegating to an exhausted or partially consumed generator.
  var g = deep(0);
  g.next();
  assertEq(results((function*() { return yield* g; })()),
           '{"value":2,"done":false},{"value":"deep","done":true}');
  assertEq(results((function*() { return yield* g; })()), '{"done":true}');

  // An overridden `next` on the inner generator is called.
  var o = inner();
  o.next = () => ({ done: true, value: "overridden" });
  assertEq(results((function*() { return yield* o; })()),
           '{"value":"overridden","done":true}');
}

// Generators from another realm.
for (var g of [newGlobal({ sameCompartmentAs: this }), newGlobal({ newCompartment: true })]) {
  for (var i = 0; i < 50; i++) {
    var inner = g.eval("(function*() { yield 1; return 2; })()");
    var outer = (function*() { return yield* inner; })();
    assertEq(results(outer), '{"value":1,"done":false},{"value":2,"done":true}');
  }
}
