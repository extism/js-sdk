;; source for wasm/circular-rhs.wasm
(module
  (import "lhs" "mul_two" (func $alpha (param i32) (result i32)))
  (memory (export "memory") 0)
  (func (export "add_one") (param $in i32) (result i32)
    (call $alpha (i32.add (local.get $in) (i32.const 1)))
  )
)

