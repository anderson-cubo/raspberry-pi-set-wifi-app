import template from '../../helpers/template'

import path from 'path'

import * as config from '../../../config'

import _ from 'lodash'

import fs from 'fs'
import cp from 'child_process'

import * as wpa from '../../helpers/wpa.js'

const iw = require('iwlist')(config.IFFACE)

let status = null

export const disconnect = async () => {
  try {
    await wpa.disconnect()
    status = 'disconnected'
  } catch (err) {
    throw err
  }
}

let scanned = []

const execIgnoreFail = params => {
  try {
    return cp.execSync(params)
  } catch (err) {
    console.error(err)
  }

  return null
}

execIgnoreFail('sudo systemctl stop hostapd')
execIgnoreFail(`sudo iw dev ${config.IFFACE_CLIENT} interface add ${config.IFFACE} type __ap`)

const _scan = () => new Promise((resolve, reject) => {
  iw.scan((err, result) => {
    if (err) return reject(err)

    if (result.length > 0) {
      scanned = result.map(d => ({ ssid: d.essid, ...d }))
    }

    resolve(scanned)
  })
})

export const scan = async () => {
  if (scanned.length > 0) {
    _scan()
    return scanned
  }

  return _scan()
}

export const checkIfIsConnected = () => {
  const exec = String(execIgnoreFail(`iw ${config.IFFACE_CLIENT} link`) || 'Not connected')
  return exec.includes('Not connected') === false
}

export const connect = async (ssid, password, countryCode = config.COUNTRY) => {
  if (status === 'connecting') return { status: 'pending', success: false }

  const fileName = '/etc/wpa_supplicant/wpa_supplicant.conf'

  const fileString = fs.readFileSync(fileName).toString()

  if (!ssid && fileString.includes('network=') === false) throw new Error('COULD_NOT_CONNECT')
  if (!ssid && checkIfIsConnected()) return { success: true }

  if (ssid) wpa.setConfig({ countryCode, ssid, password })

  status = 'connecting'

  try {
    await wpa.connect()
    status = 'connected'
  } catch (err) {
    status = 'failed'
    throw err
  }

  execIgnoreFail(`sudo ifconfig ${config.IFFACE_CLIENT} up`)

  return { success: true }
}

export const enableAccessPoint = async () => {
  console.log('ENABLING ACCESS POINT')
  const transpileDhcpcd = template(path.join(__dirname, '../../templates/dhcpcd/dhcpcd.ap.hbs'), {
    wifi_interface: config.IFFACE,
    ip_addr: config.IPADDRESS
  })

  fs.writeFileSync('/etc/dhcpcd.conf', transpileDhcpcd)

  const transpileDnsmasq = template(path.join(__dirname, '../../templates/dnsmasq/dnsmasq.ap.hbs'), {
    wifi_interface: config.IFFACE,
    subnet_range_start: config.SUBNET_RANGE_START,
    subnet_range_end: config.SUBNET_RANGE_END,
    netmask: config.NETMASK
  })

  fs.writeFileSync('/etc/dnsmasq.conf', transpileDnsmasq)

  const transpileHostapd = template(path.join(__dirname, '../../templates/hostapd/hostapd.ap.hbs'), {
    ssid: config.SSID,
    wifi_interface: config.IFFACE
  })

  fs.writeFileSync('/etc/hostapd/hostapd.conf', transpileHostapd)

  console.log('RESTART DHCPCD')
  execIgnoreFail('sudo systemctl restart dhcpcd')
  console.log('RESTART HOSTAPD')
  execIgnoreFail('sudo systemctl enable hostapd')
  execIgnoreFail('sudo systemctl unmask hostapd')
  execIgnoreFail('sudo systemctl start hostapd')
  execIgnoreFail('sudo systemctl restart hostapd')
  console.log('RESTART DNSMASQ')
  execIgnoreFail('sudo systemctl restart dnsmasq')
  console.log('SUCESS')
}

export const disableAccessPoint = async () => {
  console.log('DISABLING ACCESS POINT')
  const transpileDhcpcd = template(path.join(__dirname, '../../templates/dhcpcd/dhcpcd.client.hbs'), {
    wifi_interface: config.IFFACE,
    ip_addr: config.IPADDRESS
  })

  fs.writeFileSync('/etc/dhcpcd.conf', transpileDhcpcd)

  const transpileDnsmasq = template(path.join(__dirname, '../../templates/dnsmasq/dnsmasq.client.hbs'), {
    wifi_interface: config.IFFACE,
    subnet_range_start: config.SUBNET_RANGE_START,
    subnet_range_end: config.SUBNET_RANGE_END,
    netmask: config.NETMASK
  })

  fs.writeFileSync('/etc/dnsmasq.conf', transpileDnsmasq)

  const transpileHostapd = template(path.join(__dirname, '../../templates/hostapd/hostapd.client.hbs'), {
    ssid: config.SSID,
    wifi_interface: config.IFFACE
  })

  fs.writeFileSync('/etc/hostapd/hostapd.conf', transpileHostapd)

  execIgnoreFail('sudo systemctl stop dnsmasq')
  execIgnoreFail('sudo systemctl stop hostapd')
  execIgnoreFail('sudo systemctl disable hostapd')
  execIgnoreFail('sudo systemctl restart dhcpcd')

  try {
    await connect()
  } catch (err) {
    console.error(err)
  }
}
