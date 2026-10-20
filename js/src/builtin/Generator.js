/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

// Sync generators yield bare values, which are wrapped in iterator result
// objects here so that the JITs can scalar replace the result object when these
// functions are inlined into the caller. `yield*` yields the inner iterator's
// result object as-is and marks it with GENERATOR_RESULT_KIND_ITER_RESULT.
//
// Keep the marked case in a separate call: it's cold for most call sites, which
// lets Warp prune it so that the returned object doesn't escape through a phi.
function GeneratorTakeYieldedIterResult(gen, result) {
  UnsafeSetReservedSlot(gen, GENERATOR_RESULT_KIND_SLOT, GENERATOR_RESULT_KIND_YIELDED);
  return result;
}

// Called from `yield*` bytecode before yielding the inner result object.
function GeneratorSetYieldedIterResult(gen) {
  UnsafeSetReservedSlot(gen, GENERATOR_RESULT_KIND_SLOT, GENERATOR_RESULT_KIND_ITER_RESULT);
}

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

  var kind = UnsafeGetInt32FromReservedSlot(this, GENERATOR_RESULT_KIND_SLOT);
  if (kind === GENERATOR_RESULT_KIND_ITER_RESULT) {
    return GeneratorTakeYieldedIterResult(this, result);
  }
  return { value: result, done: kind === GENERATOR_RESULT_KIND_RETURNED };
}
SetIsInlinableLargeFunction(GeneratorNext);

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

  var kind = UnsafeGetInt32FromReservedSlot(this, GENERATOR_RESULT_KIND_SLOT);
  if (kind === GENERATOR_RESULT_KIND_ITER_RESULT) {
    return GeneratorTakeYieldedIterResult(this, result);
  }
  return { value: result, done: kind === GENERATOR_RESULT_KIND_RETURNED };
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

  var kind = UnsafeGetInt32FromReservedSlot(this, GENERATOR_RESULT_KIND_SLOT);
  if (kind === GENERATOR_RESULT_KIND_ITER_RESULT) {
    return GeneratorTakeYieldedIterResult(this, result);
  }
  return { value: result, done: kind === GENERATOR_RESULT_KIND_RETURNED };
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
