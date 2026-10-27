/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

// Sync generators yield bare values, which are wrapped in iterator result
// objects here so that the JITs can scalar replace the result object when these
// functions are inlined into the caller. `yield*` yields the inner iterator's
// result object as-is from a yield whose resume index is tagged with
// GENERATOR_RESUME_INDEX_ITER_RESULT_TAG. A closed generator's resume index is
// GENERATOR_RESUME_INDEX_CLOSED. Both are at least
// GENERATOR_RESUME_INDEX_ITER_RESULT_TAG, so a plain yield is a single compare.
// BytecodeEmitter::emitYieldStarForwardingLoop resumes inner generators
// directly and checks their resume index in the same way.
//
// Keep the iterator result object case in a separate call: it's cold for most
// call sites, which lets Warp prune it so that the returned object doesn't
// escape through a phi.
function GeneratorYieldedIterResult(result) {
  return result;
}

// Unique object returned by IteratorStepValue and the *IteratorStep helpers
// to signal completion. Never exposed to content.
var IterationDoneSentinel = CreateUniqueTenuredObject();

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

  var resumeIndex = UnsafeGetInt32FromReservedSlot(this, GENERATOR_RESUME_INDEX_SLOT);
  var done = false;
  if (resumeIndex >= GENERATOR_RESUME_INDEX_ITER_RESULT_TAG) {
    if (resumeIndex !== GENERATOR_RESUME_INDEX_CLOSED) {
      return GeneratorYieldedIterResult(result);
    }
    done = true;
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

  var resumeIndex = UnsafeGetInt32FromReservedSlot(gen, GENERATOR_RESUME_INDEX_SLOT);
  if (resumeIndex < GENERATOR_RESUME_INDEX_ITER_RESULT_TAG) {
    return result;
  }
  if (resumeIndex === GENERATOR_RESUME_INDEX_CLOSED) {
    return IterationDoneSentinel;
  }
  return GeneratorStepYieldedIterResult(result);
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

  var resumeIndex = UnsafeGetInt32FromReservedSlot(this, GENERATOR_RESUME_INDEX_SLOT);
  var done = false;
  if (resumeIndex >= GENERATOR_RESUME_INDEX_ITER_RESULT_TAG) {
    if (resumeIndex !== GENERATOR_RESUME_INDEX_CLOSED) {
      return GeneratorYieldedIterResult(result);
    }
    done = true;
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

  var resumeIndex = UnsafeGetInt32FromReservedSlot(this, GENERATOR_RESUME_INDEX_SLOT);
  var done = false;
  if (resumeIndex >= GENERATOR_RESUME_INDEX_ITER_RESULT_TAG) {
    if (resumeIndex !== GENERATOR_RESUME_INDEX_CLOSED) {
      return GeneratorYieldedIterResult(result);
    }
    done = true;
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
