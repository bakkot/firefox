// |jit-test| --enable-joint-iteration

load(libdir + "asserts.js");

// Self-hosted iteration skips iterator result objects for built-in iterators.
// Check that this is unobservable.

const ArrayIteratorPrototype = Object.getPrototypeOf([].values());
const MapIteratorPrototype = Object.getPrototypeOf(new Map().values());
const SetIteratorPrototype = Object.getPrototypeOf(new Set().values());
const StringIteratorPrototype = Object.getPrototypeOf(""[Symbol.iterator]());

function sources() {
  return [
    () => [1, 2, 3].values(),
    () => [1, 2, 3].keys(),
    () => [1, 2, 3].entries(),
    () => new Int8Array([1, 2, 3]).values(),
    () => new Map([[1, 2], [3, 4]]).keys(),
    () => new Map([[1, 2], [3, 4]]).values(),
    () => new Map([[1, 2], [3, 4]]).entries(),
    () => new Set([1, 2, 3]).values(),
    () => new Set([1, 2, 3]).entries(),
    () => "a\u{1F600}b"[Symbol.iterator](),
    function*() { yield 1; yield 2; },
  ];
}

function expected(makeIter) {
  var result = [];
  var iter = makeIter();
  while (true) {
    var r = iter.next();
    if (r.done) {
      return result;
    }
    result.push(r.value);
  }
}

function consumers() {
  return [
    it => Array.from(it),
    it => [...new Set(it)],
    it => Iterator.from(it).toArray(),
    it => Iterator.from(it).map(x => x).toArray(),
    it => Iterator.from(it).reduce((acc, x) => (acc.push(x), acc), []),
    it => {
      var r = [];
      Iterator.from(it).forEach(x => r.push(x));
      return r;
    },
    it => Iterator.zip([it]).map(([x]) => x).toArray(),
  ];
}

function sameValues(actual, expected) {
  assertEq(actual.length, expected.length);
  for (var i = 0; i < actual.length; i++) {
    if (Array.isArray(expected[i])) {
      assertEq(actual[i].toString(), expected[i].toString());
    } else {
      assertEq(actual[i], expected[i]);
    }
  }
}

// Basic behavior, polymorphic over many source kinds.
for (var i = 0; i < 50; i++) {
  for (var consume of consumers()) {
    for (var src of sources()) {
      sameValues(consume(src()), expected(src));
    }
  }
}

// Overridden `next` on the instance and on the prototype.
function overrideTest(proto, makeIter) {
  for (var i = 0; i < 50; i++) {
    var it = makeIter();
    var calls = 0;
    it.next = function() {
      calls++;
      return calls <= 2 ? { done: false, value: calls } : { done: true };
    };
    sameValues(Array.from(it), [1, 2]);
    assertEq(calls, 3);

    var origNext = proto.next;
    var protoCalls = 0;
    proto.next = function() {
      protoCalls++;
      var r = origNext.call(this);
      if (!r.done) {
        r.value = "x";
      }
      return r;
    };
    try {
      var r = Array.from(makeIter());
      assertEq(r.length > 0, true);
      assertEq(r.every(v => v === "x"), true);
      assertEq(protoCalls, r.length + 1);
    } finally {
      proto.next = origNext;
    }
  }
}
overrideTest(ArrayIteratorPrototype, () => [1, 2].values());
overrideTest(MapIteratorPrototype, () => new Map([[1, 2]]).keys());
overrideTest(SetIteratorPrototype, () => new Set([1, 2]).values());
overrideTest(StringIteratorPrototype, () => "ab"[Symbol.iterator]());

// `next` is read once, before iteration starts.
for (var i = 0; i < 50; i++) {
  var it = [1, 2, 3].values();
  var r = [];
  for (var v of Iterator.from(it).map(x => {
    it.next = () => { throw new Error("should not be called"); };
    return x;
  })) {
    r.push(v);
  }
  sameValues(r, [1, 2, 3]);
}

// Mutation during iteration.
for (var i = 0; i < 50; i++) {
  var arr = [1, 2, 3];
  var seen = Iterator.from(arr.values()).map(x => {
    if (x === 1) {
      arr.push(4);
    }
    if (x === 2) {
      arr.length = 3;
    }
    return x;
  }).toArray();
  sameValues(seen, [1, 2, 3]);

  var map = new Map([[1, 1], [2, 2], [3, 3]]);
  seen = Iterator.from(map.keys()).map(k => {
    if (k === 1) {
      map.delete(2);
      map.set(4, 4);
    }
    return k;
  }).toArray();
  sameValues(seen, [1, 3, 4]);

  var set = new Set([1, 2]);
  var setIter = set.values();
  sameValues(Array.from(setIter), [1, 2]);
  set.add(3);
  sameValues(Array.from(setIter), []);
}

// Getters on done/value of user-defined iterator results, and arbitrary
// values (including objects) returned from `next`.
for (var i = 0; i < 50; i++) {
  var log = [];
  var values = [{}, undefined, null, 0, "s", Symbol.iterator];
  var k = 0;
  var iter = {
    [Symbol.iterator]() { return this; },
    next() {
      var idx = k++;
      return {
        get done() { log.push("done" + idx); return idx >= values.length; },
        get value() { log.push("value" + idx); return values[idx]; },
      };
    },
  };
  var r = Array.from(iter);
  sameValues(r, values);
  assertEq(log.join(), "done0,value0,done1,value1,done2,value2,done3,value3," +
                       "done4,value4,done5,value5,done6");
}

// Non-object iterator results.
for (var i = 0; i < 50; i++) {
  for (var bad of [undefined, 1, "x"]) {
    var iter = {
      [Symbol.iterator]() { return this; },
      next() { return bad; },
    };
    var caught = false;
    try {
      Array.from(iter);
    } catch (e) {
      caught = e instanceof TypeError;
    }
    assertEq(caught, true);
  }
}

// Exceptions from `next` must not close the iterator; exceptions from the
// loop body must.
for (var i = 0; i < 50; i++) {
  var returnCalls = 0;
  var iter = {
    [Symbol.iterator]() { return this; },
    next() { throw new Error("next"); },
    return() { returnCalls++; return {}; },
  };
  assertThrowsInstanceOf(() => new Set(iter), Error);
  assertEq(returnCalls, 0);

  var arrIter = [1, 2].values();
  var closed = 0;
  arrIter.return = function() { closed++; return {}; };
  assertThrowsInstanceOf(() => new Map(arrIter), TypeError);
  assertEq(closed, 1);
}

// Cross-realm and cross-compartment iterators.
var sameCompartment = newGlobal({ sameCompartmentAs: this });
var otherCompartment = newGlobal({ newCompartment: true });
for (var i = 0; i < 50; i++) {
  for (var g of [sameCompartment, otherCompartment]) {
    sameValues(Array.from(g.eval("[1, 2, 3].values()")), [1, 2, 3]);
    sameValues(Array.from(g.eval("new Set([1, 2]).values()")), [1, 2]);
    sameValues(Array.from(g.eval("new Map([[1, 2]]).keys()")), [1]);
    sameValues(Array.from(g.eval("'ab'[Symbol.iterator]()")), ["a", "b"]);

    // An iterator from another realm with this realm's `next`.
    var it = g.eval("[4, 5].values()");
    it.next = ArrayIteratorPrototype.next;
    sameValues(Array.from(it), [4, 5]);
  }
}
