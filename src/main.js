const qrcode = require('qrcode-generator')
const bip39 = require('bip39')
const bsv = require('bsv')
const sb = require('satoshi-bitcoin')
const explorer = require('bitcore-explorers')
const DUST_LIMIT = 546

const app = {}
app.bsv = bsv
app.fee_per_kb = 1000
app.rpc = 'https://bchsvexplorer.com'
app.bitdb_token = ''
app.bitdb_url = 'https://bitgraph.network/q/'
app.bitsocket_url = 'https://bitgraph.network/s/'

app.on_receive_callback = null
app.default_on_receive = (data) => {
  console.log('received something!', data)
}

app.update_actions_query = () =>
  app.find_all_inputs_and_outputs(app.get_address_str(), 100)

app.bitsocket_listener = null
app.default_bitsocket_listener = () => {
  return app.initialize_bitsocket_listener(
    app.find_all_outputs_without_inputs(app.get_address_str(), 100),
    (r) => {
      if (r.type == 'mempool') {
        const tx = r.data[0]
        let sats = 0
        for (const j of r.data[0].out) {
          if (j.e.a == app.get_address_str()) {
            sats += j.e.v
          }
        }
        app.received_transaction(tx, sats)
        app.update_utxos()
        app.update_actions()
      }
      if (r.type == 'block') {
        app.update_actions()
      }
    }
  )
}

app.init = (options = {}, callback) => {
  // overwrite any variables in app passed from options
  for (const o of Object.entries(options)) {
    app[o[0]] = o[1]
  }

  app.insight = new explorer.Insight(app.rpc)

  // takes bsv value
  const check_send_validity = (val) => {
    let ret = true

    const amount_sat = app.bsv2sat(val)
    if (amount_sat > 0 &&
        amount_sat <= app.get_balance() + app.get_unconfirmed_balance()) {
    } else {
      ret = false
    }

    if(callback) {
      callback()
    }

    return ret
  }
}

app.received_transaction = (tx, satoshis) => {
  localStorage.setItem('satchel.balance', app.get_balance() + satoshis)

  app.on_receive_callback({ tx: tx, satoshis: satoshis })
  setTimeout(() => {
    app.update_utxos()
  }, 5000)
}

app.before_effects = {}
app.after_effects = {}

app.before = (method, callback) => {
  if (typeof app.before_effects[method] === 'undefined') {
    app.before_effects[method] = []
  }

  app.before_effects[method].push(callback)
}

app.after = (method, callback) => {
  if (typeof app.after_effects[method] === 'undefined') {
    app.after_effects[method] = []
  }

  app.after_effects[method].push(callback)
}

app.call_before = (method, args) => {
  if (typeof app.before_effects[method] !== 'undefined') {
    for (const o of app.before_effects[method]) {
      o(...args)
    }
  }
}

app.call_after = (method, args) => {
  if (typeof app.after_effects[method] !== 'undfined') {
    for (const o of app.after_effects[method]) {
      o(...args)
    }
  }
}

app.sat2bsv = (sat) => sb.toBitcoin(sat)
app.bsv2sat = (bsv) => sb.toSatoshi(bsv) | 0

app.receive_address_link_url_mapper = (address) => `https://bchsvexplorer.com/address/${address}`
app.tx_link_url_mapper = (txid) => `https://bchsvexplorer.com/tx/${txid}`

app.get_balance = () => +localStorage.getItem('satchel.balance')
app.get_unconfirmed_balance = () => +localStorage.getItem('satchel.unconfirmed-balance')
app.get_wif = () => localStorage.getItem('satchel.wif')
app.is_logged_in = () => !!app.get_wif()
app.get_private_key = () => new bsv.PrivateKey(app.get_wif())
app.get_address = () => app.get_private_key().toAddress()
app.get_address_str = () => app.get_address().toString()
app.get_utxos = () => JSON.parse(localStorage.getItem('satchel.utxo'))

app.generate_qr_code = (address) => {
  app.call_before('generate_qr_code', [address])

  const type_number = 0
  const error_correction_level = 'H'

  const qr = qrcode(type_number, error_correction_level)
  qr.addData(address.toString())
  qr.make()

  app.call_after('generate_qr_code', [address, qr])

  return qr
}

app.generate_address = () => {
  const mnemonic = bip39.generateMnemonic()
  const seed = bip39.mnemonicToSeed(mnemonic)
  const hash = bsv.crypto.Hash.sha256(seed)
  const bn = bsv.crypto.BN.fromBuffer(hash)
  const key = new bsv.PrivateKey(bn)
  const address = key.toAddress().toString()

  return {
    'address': address,
    'mnemonic': mnemonic
  }
}

app.import_mnemonic = (mnemonic) => {
  if (!bip39.validateMnemonic(mnemonic)) {
    window.alert('Invalid mnemonic')
    return false
  }

  const seed = bip39.mnemonicToSeed(mnemonic)
  const hash = bsv.crypto.Hash.sha256(seed)
  const bn = bsv.crypto.BN.fromBuffer(hash)
  const key = new bsv.PrivateKey(bn)
  const wif = key.toWIF()

  return wif
}

app.import_wif = (wif) => {
  // todo: allow uncompressed wifs
  // todo: perform better checking of validity

  if (wif.length != 52) {
    window.alert('WIF length must be 52')
    return false
  }

  if (wif[0] != 'K' && wif[0] != 'L') {
    window.alert('WIF must start with either a K or an L')
    return false
  }

  return wif
}

app.login = (wif, callback) => {
  app.call_before('login', [wif])
  localStorage.setItem('satchel.wif', wif)
  app.update_balance()
  if (!app.bitsocket_listener) {
    app.bitsocket_listener = app.default_bitsocket_listener()
  }
  if (!app.on_receive_callback) {
    app.on_receive_callback = app.default_on_receive
  }
  if (callback) {
    callback()
  }

  app.call_after('login', [wif])
}

app.logout = (callback) => {
  app.call_before('logout', [])

  const localstorage_keys = []
  for (let i = 0; i < localStorage.length; ++i) {
    if (localStorage.key(i).substring(0, 7) == 'satchel') {
      localstorage_keys.push(localStorage.key(i))
    }
  }

  for (const k of localstorage_keys) {
    localStorage.removeItem(k)
  }

  if (app.bitsocket_listener) {
    app.bitsocket_listener.close()
  }

  if (callback) {
    callback()
  }

  app.call_after('logout', [])
}

app.send = (address, satoshis, callback) => {
  app.call_before('send', [address, satoshis])

  if (!app.is_logged_in()) {
    throw new Error('satchel: sending without being logged in')
  }

  if (!bsv.Address.isValid(address)) {
    throw new Error('satchel: invalid address')
  }

  let tx = new bsv.Transaction()
  tx.from(app.get_utxos())
  tx.to(address, satoshis)
  tx.feePerKb(app.fee_per_kb)
  tx.change(app.get_address())

  tx = app.clean_tx_dust(tx)
  tx.sign(app.get_private_key())

  app.broadcast_tx(tx, (tx) => {
    if (callback) {
      callback(tx)
    }
  })

  app.call_after('send', [address, satoshis, tx])
}

app.clean_tx_dust = (tx) => {
  for (let i = 0; i < tx.outputs.length; ++i) {
    if (tx.outputs[i]._satoshis > 0 && tx.outputs[i]._satoshis < DUST_LIMIT) {
      tx.outputs.splice(i, 1)
      --i
    }
  }

  return tx
}

app.add_op_return_data = (tx, data) => {
  const script = new bsv.Script()

  script.add(bsv.Opcode.OP_RETURN)

  for (const m of data) {
    if (m['type'] == 'hex') {
      script.add(Buffer.from(m['v'], 'hex'))
    } else if (m['type'] == 'str') {
      script.add(Buffer.from(m['v']))
    } else {
      throw new Error('unknown data type')
    }
  }

  tx.addOutput(new bsv.Transaction.Output({
    script: script,
    satoshis: 0
  }))

  return tx
}

app.broadcast_tx = (tx, callback, err_callback, options = {
  safe: true, // check serialization
  testing: false // if true dont actually broadcast to network
}) => {
  app.call_before('broadcast_tx', [tx])

  let tx_data = ''
  if (options.safe) {
    tx_data = tx.serialize()
  } else {
    tx_data = tx.uncheckedSerialize()
  }

  if (options.testing) {
    if (callback) {
      callback(tx)
    }

    app.call_after('broadcast_tx', [tx])
  } else {
    app.insight.broadcast(tx_data, (err, res) => {
      if (err) {
        if (err_callback) {
          err_callback(err)
        }
      } else {
        if (callback) {
          callback(tx)
        }

        app.call_after('broadcast_tx', [tx])
      }
    })
  }
}

app.update_balance = (callback, err_callback) => {
  app.call_before('update_balance', [])

  app.insight.address(app.get_address_str(), (err, addr_info) => {
    if (err) {
      if (err_callback) {
        err_callback(err)
      }
    } else {
      localStorage.setItem('satchel.balance',
        addr_info['balance'])
      localStorage.setItem('satchel.unconfirmed-balance',
        addr_info['unconfirmedBalance'])
      localStorage.setItem('satchel.total-sent',
        addr_info['totalSent'])
      localStorage.setItem('satchel.total-received',
        addr_info['totalReceived'])

      if (callback) {
        callback(addr_info)
      }

      app.call_after('update_balance', [])
    }
  })
}

app.update_utxos = (callback, err_callback) => {
  app.call_before('update_utxos', [])

  app.insight.getUnspentUtxos(app.get_address_str(), (err, utxo_info) => {
    if (err) {
      if (err_callback) {
        err_callback(err)
      }
    } else {
      const utxos = JSON.parse(JSON.stringify(utxo_info)).map((v) => ({
        txId: v['txid'],
        outputIndex: v['vout'],
        address: v['address'],
        script: v['scriptPubKey'],
        satoshis: app.bsv2sat(v['amount'])
      }))

      utxos.sort((a, b) => (a.satoshis > b.satoshis) ? 1
        : ((a.satoshis < b.satoshis) ? -1
          : 0))

      localStorage.setItem('satchel.utxo', JSON.stringify(utxos))

      if (callback) {
        callback(utxo_info)
      }

      app.call_after('update_utxos', [utxos])
    }
  })
}

app.update_actions = (callback) => {
  app.call_before('update_actions', [])
  app.query_bitdb(app.update_actions_query(), (r) => {
    if (callback) {
      callback(r)
    }

    app.call_after('update_actions', [])
  })
}

app.query_bitdb = (q, callback, fail) => {
  if (app.bitdb_token === '') {
    window.alert('bitdb_token option not set')
  }

  const b64 = btoa(JSON.stringify(q))
  const url = app.bitdb_url + b64

  const header = {
    headers: {
      key: app.bitdb_token
    }
  }

  fetch(url, header)
    .then((r) => r.json())
    .then(callback).catch(fail)
}

app.initialize_bitsocket_listener = (q, callback) => {
  const b64 = btoa(JSON.stringify(q))
  const url = app.bitsocket_url + b64

  const socket = new EventSource(url)
  socket.onmessage = (e) => {
    callback(JSON.parse(e.data))
  }

  return socket
}

app.find_all_inputs_and_outputs = (addr, limit) => ({
  v: 3,
  q: {
    find: {
      '$or': [
        { 'in.e.a': addr },
        { 'out.e.a': addr }
      ]
    },
    limit: limit
  }
})

app.find_all_outputs_without_inputs = (addr, limit) => ({
  v: 3,
  q: {
    find: {
      'in.e.a': { '$ne': addr },
      'out.e.a': addr
    }
  }
})

window.satchel = app
