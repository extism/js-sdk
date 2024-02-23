(module
    ;;(import "side" "memory" (memory $memory 0))

    (import "side" "run_test" (func $run_test (result i32)))
    (import "extism:host/env" "store_u64" (func $store_u64 (param i64 i64)))
    (import "extism:host/env" "alloc" (func $alloc (param i64) (result i64)))
    (import "extism:host/env" "output_set" (func $output_set (param i64 i64)))
    (memory (export "memory") 0)
    (func (export "run_test") (result i32)
        (call $run_test)
    )
)
