(module
  (func $loop (export "loop")
    (loop $loop (br $loop))
  )
  (start $loop)
)
