(module
    (import "extism:host/env" "store_u64" (func $store_u64 (param i64 i64)))
    (import "extism:host/env" "store_u8" (func $store_u8 (param i64 i32)))
    (import "extism:host/env" "alloc" (func $alloc (param i64) (result i64)))
    (import "extism:host/env" "var_set" (func $var_set (param i64 i64)))
    (import "extism:host/env" "var_get" (func $var_get (param i64) (result i64)))
    (import "user" "test" (func $test (param i64)))

    (memory $mem (export "memory") 1)
    (data (memory $mem) (offset i32.const 0) "hi there")
    (func (export "test") (result i32)
      (local $var_offset i64)
      (local.set $var_offset (call $alloc (i64.const 8)))
      (call $store_u64 (local.get $var_offset) (i64.load (i32.const 0)))

      (call $var_set (local.get $var_offset) (local.get $var_offset))

      (call $test (call $var_get (local.get $var_offset)))
      (i32.const 0)
    )
)
