(module
  (func (export "loop")
    (loop $loop (br $loop))
  )
)
