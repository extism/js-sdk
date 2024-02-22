(module
    (import "lhs" "mul_two" (func $mul_two (param i32) (result i32)))
    (import "extism:host/env" "store_u64" (func $store_u64 (param i64 i64)))
    (import "extism:host/env" "alloc" (func $alloc (param i64) (result i64)))
    (import "extism:host/env" "output_set" (func $output_set (param i64 i64)))
    (memory (import "rhs" "memory") 0)

    (func (export "encalculate") (result i32)
        (local $output i64)
        (local.set $output (call $alloc (i64.const 8)))

        (call $store_u64 (local.get $output) (i64.extend_i32_u (call $mul_two (i32.const 1))))
        (call $output_set (local.get $output) (i64.const 8))
        i32.const 0
    )
)
