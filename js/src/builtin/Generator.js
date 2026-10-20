/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

// Sync generators yield bare values, which are wrapped in iterator result
// objects here so that the JITs can scalar replace the result object when these
// functions are inlined into the caller. `yield*` yields the inner iterator's
// result object as-is from a yield whose resume index is tagged with
// GENERATOR_RESUME_INDEX_ITER_RESULT_TAG. A closed generator has a null resume
// index.
//
// Keep the iterator result object case in a separate call: it's cold for most
// call sites, which lets Warp prune it so that the returned object doesn't
// escape through a phi.
function GeneratorYieldedIterResult(result) {
  return result;
}

// Unique objects returned by GeneratorYieldStarNext (and, for
// IterationDoneSentinel, by IteratorStepValue and the *IteratorStep helpers).
// Never exposed to content.
var IterationDoneSentinel = CreateUniqueTenuredObject();
var YieldStarIterResultSentinel = CreateUniqueTenuredObject();

// The value that goes with the sentinel GeneratorYieldStarNext returned, in
// element 0. Read back and cleared immediately by the `yield*` bytecode (see
// BytecodeEmitter::emitYieldStar). This must be tenured so that Warp can bake
// it into compiled code.
var globalYieldStarStash = CreateTenuredHolder();

// The "next" step of `yield*` in a sync generator: calls |next| on the inner
// iterator |iter| with |received|. Returns one of:
//
// - IterationDoneSentinel, if |iter| is a generator that returned. Its return
//   value is in globalYieldStarStash.
// - YieldStarIterResultSentinel, with the inner iterator result object in
//   globalYieldStarStash. The `yield*` bytecode checks it for `done` as usual,
//   and otherwise yields it as-is.
// - Otherwise, a bare value for the outer generator to yield.
//
// When |iter| is a suspended same-realm generator using the original
// GeneratorNext, it is resumed directly and a bare yielded value is passed
// through. This skips the inner iterator result object, which is unobservable
// because GeneratorNext would have created a fresh plain object.
function GeneratorYieldStarNext(iter, next, received) {
  var result;
  if (
    next === GeneratorNext &&
    IsSuspendedGenerator(iter) &&
    !DebuggerObservesNativeCall()
  ) {
    try {
      result = resumeGenerator(iter, received, "next");
    } catch (e) {
      GeneratorSetClosed(iter);
      throw e;
    }

    var resumeIndex = UnsafeGetReservedSlot(iter, GENERATOR_RESUME_INDEX_SLOT);
    if (resumeIndex === null) {
      globalYieldStarStash[0] = result;
      return IterationDoneSentinel;
    }
    if (resumeIndex < GENERATOR_RESUME_INDEX_ITER_RESULT_TAG) {
      return result;
    }

    // |iter| itself yielded an inner result object with `yield*`, which must
    // be passed through as-is.
    assert(IsObject(result), "yield* only yields objects");
  } else {
    result = callContentFunction(next, iter, received);
    if (!IsObject(result)) {
      ThrowTypeError(JSMSG_ITER_METHOD_RETURNED_PRIMITIVE, "next");
    }
  }

  globalYieldStarStash[0] = result;
  return YieldStarIterResultSentinel;
}
SetIsInlinableLargeFunction(GeneratorYieldStarNext);

function GeneratorNext(val) {
  // Call GeneratorNextSlow for uncommon cases so that GeneratorNext stays small
  // and can be inlined. The IsSuspendedGenerator check is inlined in the JITs.
  // It's false for generators from other realms, whose result objects must be
  // created in the generator's realm.
  if (!IsSuspendedGenerator(this)) {
    return callFunction(GeneratorNextSlow, this, val);
  }

  var result;
  try {
    result = resumeGenerator(this, val, "next");
  } catch (e) {
    GeneratorSetClosed(this);
    throw e;
  }

  var resumeIndex = UnsafeGetReservedSlot(this, GENERATOR_RESUME_INDEX_SLOT);
  var done = resumeIndex === null;
  if (!done && resumeIndex >= GENERATOR_RESUME_INDEX_ITER_RESULT_TAG) {
    return GeneratorYieldedIterResult(result);
  }
  return { value: result, done };
}
SetIsInlinableLargeFunction(GeneratorNext);

// Resumes the suspended same-realm generator |gen| like GeneratorNext, but
// returns the yielded value, or IterationDoneSentinel when the generator is
// done, instead of an iterator result object.
function GeneratorStep(gen) {
  assert(IsSuspendedGenerator(gen), "gen is a suspended generator");

  var result;
  try {
    result = resumeGenerator(gen, undefined, "next");
  } catch (e) {
    GeneratorSetClosed(gen);
    throw e;
  }

  var resumeIndex = UnsafeGetReservedSlot(gen, GENERATOR_RESUME_INDEX_SLOT);
  if (resumeIndex === null) {
    return IterationDoneSentinel;
  }
  if (resumeIndex >= GENERATOR_RESUME_INDEX_ITER_RESULT_TAG) {
    return GeneratorStepYieldedIterResult(result);
  }
  return result;
}
SetIsInlinableLargeFunction(GeneratorStep);

// `yield*` yielded the inner iterator's result object, which GeneratorNext
// would have returned as-is. Read `done` and `value` from it as the caller of
// GeneratorNext would.
function GeneratorStepYieldedIterResult(result) {
  assert(IsObject(result), "yield* only yields objects");
  if (result.done) {
    return IterationDoneSentinel;
  }
  return result.value;
}

function GeneratorNextSlow(val) {
  if (!IsObject(this) || !IsGeneratorObject(this)) {
    return callFunction(CallGeneratorMethodIfWrapped, this, val, "GeneratorNext");
  }

  if (GeneratorObjectIsClosed(this)) {
    return { value: undefined, done: true };
  }

  if (GeneratorIsRunning(this)) {
    ThrowTypeError(JSMSG_NESTING_GENERATOR);
  }

  var result;
  try {
    result = resumeGenerator(this, val, "next");
  } catch (e) {
    GeneratorSetClosed(this);
    throw e;
  }

  return GeneratorIterResult(this, result);
}

function GeneratorThrow(val) {
  if (!IsSuspendedGenerator(this)) {
    return callFunction(GeneratorThrowSlow, this, val);
  }

  var result;
  try {
    result = resumeGenerator(this, val, "throw");
  } catch (e) {
    GeneratorSetClosed(this);
    throw e;
  }

  var resumeIndex = UnsafeGetReservedSlot(this, GENERATOR_RESUME_INDEX_SLOT);
  var done = resumeIndex === null;
  if (!done && resumeIndex >= GENERATOR_RESUME_INDEX_ITER_RESULT_TAG) {
    return GeneratorYieldedIterResult(result);
  }
  return { value: result, done };
}

function GeneratorThrowSlow(val) {
  if (!IsObject(this) || !IsGeneratorObject(this)) {
    return callFunction(
      CallGeneratorMethodIfWrapped,
      this,
      val,
      "GeneratorThrow"
    );
  }

  if (GeneratorObjectIsClosed(this)) {
    throw val;
  }

  if (GeneratorIsRunning(this)) {
    ThrowTypeError(JSMSG_NESTING_GENERATOR);
  }

  var result;
  try {
    result = resumeGenerator(this, val, "throw");
  } catch (e) {
    GeneratorSetClosed(this);
    throw e;
  }

  return GeneratorIterResult(this, result);
}

function GeneratorReturn(val) {
  if (!IsSuspendedGenerator(this)) {
    return callFunction(GeneratorReturnSlow, this, val);
  }

  var result;
  try {
    result = resumeGenerator(this, val, "return");
  } catch (e) {
    GeneratorSetClosed(this);
    throw e;
  }

  var resumeIndex = UnsafeGetReservedSlot(this, GENERATOR_RESUME_INDEX_SLOT);
  var done = resumeIndex === null;
  if (!done && resumeIndex >= GENERATOR_RESUME_INDEX_ITER_RESULT_TAG) {
    return GeneratorYieldedIterResult(result);
  }
  return { value: result, done };
}

function GeneratorReturnSlow(val) {
  if (!IsObject(this) || !IsGeneratorObject(this)) {
    return callFunction(
      CallGeneratorMethodIfWrapped,
      this,
      val,
      "GeneratorReturn"
    );
  }

  if (GeneratorObjectIsClosed(this)) {
    return { value: val, done: true };
  }

  if (GeneratorIsRunning(this)) {
    ThrowTypeError(JSMSG_NESTING_GENERATOR);
  }

  var result;
  try {
    result = resumeGenerator(this, val, "return");
  } catch (e) {
    GeneratorSetClosed(this);
    throw e;
  }

  return GeneratorIterResult(this, result);
}
