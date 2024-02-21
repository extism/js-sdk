;; source for wasm/circular-lhs.wasm
(module
  (import "rhs" "add_one" (func $alpha (param i32) (result i32)))
  (func (export "mul_two") (param $in i32) (result i32)
    (i32.gt_u (local.get $in) (i32.const 100))
    (if (result i32)
      (then
        (local.get $in)
      )
      (else
        (call $alpha (i32.mul (local.get $in) (i32.const 2)))
      )
    )
  )
)
