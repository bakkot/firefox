// |jit-test| --fast-warmup; --no-threads

function* inner(value) {
  yield value;
  return value + 1;
}

function* outer() {
  for (let i = 0; i < 2; i++) {
    for (let j = 0; j < 2; j++) {
      yield* [i, j];
      yield yield* inner(i + j);
    }
    yield* ["end"];
  }
  return "done";
}

function check(result, value, done = false) {
  assertEq(result.value, value);
  assertEq(result.done, done);
}

for (let trial = 0; trial < 100; trial++) {
  const generator = outer();
  for (let i = 0; i < 2; i++) {
    for (let j = 0; j < 2; j++) {
      check(generator.next(), i);
      if (trial === 99) {
        gc();
      }
      check(generator.next(), j);
      check(generator.next(), i + j);
      check(generator.next(), i + j + 1);
    }
    check(generator.next(), "end");
  }
  check(generator.next(), "done", true);

  const returning = outer();
  check(returning.next(), 0);
  check(returning.return("return"), "return", true);

  const throwing = outer();
  check(throwing.next(), 0);
  let caught = false;
  try {
    throwing.throw("throw");
  } catch (error) {
    assertEq(error instanceof TypeError, true);
    caught = true;
  }
  assertEq(caught, true);
  check(throwing.next(), undefined, true);
}
