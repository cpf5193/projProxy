var net = require('net');
var dns = require('dns');
var util = require('util');


// TODO: find some way to not have to maintain state
var tunnels = {};

///////////////////////////////////////////////////
// Process command line arguments
///////////////////////////////////////////////////
if (process.argv.length != 4) {
  console.log("Usage: node proxy.js <host> <port>");
  process.exit(1);
}
var HOST = process.argv[2];
var PORT = process.argv[3];

///////////////////////////////////////////////////
// Listener for client requests
///////////////////////////////////////////////////
var listener = net.createServer({allowHalfOpen: true}, function(socket) {
  socket.on('data', function(msg) {
    handleClientData(socket, msg);
  });
  socket.on('end', function() {
    // util.log('client disconnected');
    // TODO: send the ending signal to the server
    socket.end();
  });
  socket.setTimeout(600000);
  socket.on('timeout', function() {
    util.log('client timed out.');
    // TODO: send the ending signal to the server
    socket.end();
  })
});

////////////////////////////////////////////////////////////
// Takes a message, downgrading the protocol to 1.0 and 
// changing the connection to connection: close, returning
// a Buffer with the changed header
// msg: A Buffer object containing a request from the client
////////////////////////////////////////////////////////////
function modifyRequest(msg) {
  var string = msg.toString();
  var modString = string.replace(/Proxy-connection: keep-alive/gi, 'Proxy-connection: close');
  modString = modString.replace(/Connection: keep-alive/gi, 'Connection: close');
  modString = modString.replace(/ HTTP\/[12].[10]/, ' HTTP/1.0');
  return new Buffer(modString);
}

/////////////////////////////////////////////////////////////
// Forwards a non-connect request to the appropriate server
// hostName: the name of the server to connect to
// port: the port of the server to connect to
// message: a Buffer object containing the message to send
// clientSocket: the socket of the client sending the request
/////////////////////////////////////////////////////////////
function forwardMessage(hostName, port, message, clientSocket) {
  // Create a client connection to send to the server
  var socket = new net.Socket({allowHalfOpen: true});
  try {
    socket.connect(parseInt(port), hostName, function() {
      //util.log('connected to ' + hostIp + ":" + port + "\n");
      //util.log('writing to socket: \n' + message + "\n");
      try {
        socket.write(message);
      } catch (ex) {
        util.log('error connecting to server: ' + ex);
      }
    });
  } catch (ex) {
    console.log(ex);
    // Return 502 error
  }
  
  socket.on("data", function(data) {
    //util.log('data from server:\n ' + data.toString().substring(0, 500) + "\n");
    try {
      clientSocket.write(data);
    } catch (ex) {
      util.log('error writing to server: ' + ex);
    }
  });
  socket.on('end', function() {
    // util.log('server ended');
    socket.end();
    // TODO: Send end to client
  });
  socket.on('close', function() {
    // util.log('server closed');
    socket.destroy();
    // TODO: Send close to client
  });
}

function createTunnel(hostname, port, msg, clientSocket) {
  console.log('creating tunnel');
  var socket = new net.Socket({allowHalfOpen: true});
  
  try {
    socket.connect(parseInt(port), hostName, function() {
      // Send success message
      clientSocket.write(new Buffer('HTTP/1.0 200 OK'));
      console.log('connected tunnel to ' + hostName + ":" + port);
      tunnels[hostname + ':' + port] = socket;//new socket for tunnel
    });
  } catch (ex) {
    console.log(ex);
    clientSocket.write(new Buffer('HTTP/1.0 502 Bad Gateway'));
  }
  socket.on("data", function(data) {
    util.log('data from tunnel:\n ' + data.toString().substring(0, 500) + "\n");
    try {
      clientSocket.write(data);
    } catch (ex) {
      util.log('error writing to server: ' + ex);
    }
  });
  socket.on('end', function() {
    // util.log('server ended');
    socket.end();
    // TODO: Send end to client
  });
  socket.on('close', function() {
    // util.log('server closed');
    socket.destroy();
    // TODO: Send close to client
  });
}

/////////////////////////////////////////////////////////////
// Delegates a request from the client based on the
// state of the proxy
// clientSocket: the socket of the client sending the request
// msg: the Buffer object containing the client's request
/////////////////////////////////////////////////////////////
function handleClientData(clientSocket, msg) {
  var string = msg.toString();
  var lines = string.split(/\r[\n]?/);
  var firstLine = lines[0];
  var firstLineTokens = firstLine.split(" ");
  util.log('<<< ' + firstLineTokens[0] + " " + firstLineTokens[1]);
  var hostAndPort = getHostAndPort(lines);

  // TODO: Need to determine how the proxy knows that it needs to send a message
  // to a tunnel -- is it all subsequent requests after a connect? In that case
  // Only one connect is ever honored by the proxy
  // Is it all subsequent requests to a certain server and port? if so, how do 
  // we keep track of the tunnels we have open? what is each tunnel socket listening to?
  if (hostAndPort['id'] in tunnels) {
    console.log('already in tunnel');
    var data = stripData(string);
    tunnels[hostAndPort].write(new Buffer(data));
  } else if (firstLineTokens[0] == 'CONNECT') {
    createTunnel(hostAndPort['hostName'], hostAndPort['port'], msg, clientSocket);
  } else {
    console.log('regular message');
    var modifiedBuffer = modifyRequest(msg);
    forwardMessage(hostAndPort['hostName'], hostAndPort['port'], modifiedBuffer, clientSocket);
  }
}

////////////////////////////////////////////////////////////////
// Strips off the header from msg and returns the remaining data
// msg: the string to strip the header off of
////////////////////////////////////////////////////////////////
function stripData(msg) {
  var headerAndData = msg.split(/(\r\n\r\n|\n\n)/);
  return headerAndData[1];
}


///////////////////////////////////////////////////////////////
// Takes an array of \r\n separated lines and returns an object
// { hostName: <string>, port: <int> }
///////////////////////////////////////////////////////////////
function getHostAndPort(lines) {
  var hostLine, hostname, port, firstLine;
  firstLine = lines[0];
  firstLineTokens = firstLine.split(" ");
  for(var i=0; i<lines.length; ++i) {
    if (/^host:*/i.test(lines[i])) {
      hostLine = lines[i];
    }
  }
  var hostPort = hostLine.split(':');
  hostName = hostPort[1].trim();
  var uriPort = firstLine.split(':');
  if (hostPort.length > 2) {
    port = hostPort[2].trim();
  }
  else if (port == null && uriPort.length > 1 && /:[\d]+$/.test(firstLine) == true) {
    // Look on uri line for a port
      port = uriPort.match(/:[\d]+/);
      port = port.substring(1, port.length);
  } else {
    //util.log('firstLine: ' + firstLine);
    var protocol = firstLineTokens[1].match(/^http[s]?:/);
    //util.log('protocol: ' + protocol);
    if (protocol == 'http:') {
      port = '80';
    } else {
      port = '443';
    }
  }
  var hostAndPort = {};
  hostAndPort['hostName'] = hostName;
  hostAndPort['port'] = parseInt(port);
  hostAndPort['id'] = hostName + ":" + port;
  return hostAndPort;
}

///////////////////////////////////////////////////
// Start Proxy
///////////////////////////////////////////////////
listener.listen(parseInt(PORT), HOST, 5);
util.log('Proxy listening on ' + HOST + ":" + PORT);