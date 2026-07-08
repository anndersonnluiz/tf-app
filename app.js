var app = angular.module('tfApp', []);

// Factory para gerenciar a conexão Socket.io de forma integrada ao ciclo de digestão do Angular
app.factory('socket', function($rootScope) {
  // Conecta ao servidor backend
  var socket = io.connect('http://localhost:3000');
  
  return {
    id: function() { return socket.id; },
    on: function(eventName, callback) {
      socket.on(eventName, function() {  
        var args = arguments;
        $rootScope.$apply(function() {
          callback.apply(socket, args);
        });
      });
    },
    emit: function(eventName, data, callback) {
      socket.emit(eventName, data, function() {
        var args = arguments;
        $rootScope.$apply(function() {
          if (callback) {
            callback.apply(socket, args);
          }
        });
      })
    }
  };
});

// Controller Principal do Lobby
app.controller('LobbyController', function($scope, $timeout, socket) {
  // Controle de estado da UI
  $scope.currentView = 'login';
  
  $scope.data = {
    playerName: '',
    roomCodeInput: ''
  };
  
  // Estado da Sala
  $scope.currentRoomCode = '';
  $scope.players = [];

  // Estado do Jogo
  $scope.currentRound = 0;
  $scope.currentTrump = null;
  $scope.myHand = [];
  $scope.tableCards = [];
  $scope.roomStatus = '';
  $scope.isMyTurn = false;
  $scope.betValue = 0;
  $scope.betError = '';

  $scope.message = '';
  $scope.messageType = 'success';
  
  var messageTimeout;
  
  // Exibe mensagens de feedback na interface
  function showMessage(msg, type = 'success') {
    $scope.message = msg;
    $scope.messageType = type;
    
    if (messageTimeout) {
      $timeout.cancel(messageTimeout);
    }
    
    // Oculta a mensagem após 4 segundos
    messageTimeout = $timeout(function() {
      $scope.message = '';
    }, 4000);
  }

  // Ação: Partida Rápida
  $scope.quickMatch = function() {
    if (!$scope.data.playerName || !$scope.data.playerName.trim()) {
      showMessage('Por favor, digite seu apelido antes de jogar.', 'error');
      return;
    }
    socket.emit('quick_match', { playerName: $scope.data.playerName });
  };

  // Ação: Criar Sala Privada
  $scope.createRoom = function() {
    if (!$scope.data.playerName || !$scope.data.playerName.trim()) {
      showMessage('Por favor, digite seu apelido antes de criar uma sala.', 'error');
      return;
    }
    socket.emit('create_room', { playerName: $scope.data.playerName, isPrivate: true });
  };

  // Ação: Entrar em Sala por Código
  $scope.joinRoom = function() {
    if (!$scope.data.playerName || !$scope.data.playerName.trim()) {
      showMessage('Por favor, digite seu apelido antes de entrar.', 'error');
      return;
    }
    if (!$scope.data.roomCodeInput || $scope.data.roomCodeInput.trim().length !== 4) {
      showMessage('O código da sala deve ter exatos 4 caracteres.', 'error');
      return;
    }
    
    var code = $scope.data.roomCodeInput.trim().toUpperCase();
    socket.emit('join_room', { playerName: $scope.data.playerName, roomCode: code });
  };

  // Ação: Iniciar Partida
  $scope.startGame = function() {
    if ($scope.currentRoomCode) {
      socket.emit('start_game', { roomCode: $scope.currentRoomCode });
    }
  };

  // Stepper de Apostas
  $scope.incrementBet = function() {
    if ($scope.betValue < $scope.currentRound) {
      $scope.betValue++;
      $scope.betError = '';
    }
  };

  $scope.decrementBet = function() {
    if ($scope.betValue > 0) {
      $scope.betValue--;
      $scope.betError = '';
    }
  };

  $scope.makeBet = function() {
    socket.emit('make_bet', { roomCode: $scope.currentRoomCode, bet: $scope.betValue });
  };

  // Jogar Carta
  $scope.playCard = function(card) {
    if (!$scope.isMyTurn || $scope.roomStatus !== 'PLAYING') return;
    
    // Removemos da UI temporariamente para fluidez, o server confirmará
    var idx = $scope.myHand.indexOf(card);
    if (idx > -1) {
      $scope.myHand.splice(idx, 1);
    }
    
    socket.emit('play_card', { roomCode: $scope.currentRoomCode, card: card });
  };

  // --------- Listeners de Eventos do Socket ---------
  
  socket.on('room_created', function(data) {
    $scope.currentView = 'room';
    $scope.currentRoomCode = data.roomCode;
    showMessage('Sala criada com sucesso!', 'success');
  });

  socket.on('room_joined', function(data) {
    $scope.currentView = 'room';
    $scope.currentRoomCode = data.roomCode;
    showMessage('Conectado à sala com sucesso!', 'success');
  });
  
  socket.on('room_updated', function(data) {
    // Atualiza a lista de jogadores em tempo real
    $scope.players = data.players;
  });
  
  socket.on('round_started', function(data) {
    $scope.currentView = 'table';
    $scope.roomStatus = 'BETTING';
    $scope.currentRound = data.round;
    $scope.currentTrump = data.trump;
    $scope.betValue = 0;
    $scope.betError = '';
    showMessage('Fase de apostas iniciada!', 'success');
  });

  socket.on('turn_update', function(data) {
    $scope.isMyTurn = (socket.id() === data.currentPlayerId);
    if ($scope.isMyTurn) {
      $scope.betError = '';
    }
  });

  socket.on('playing_started', function(data) {
    $scope.roomStatus = 'PLAYING';
    $scope.isMyTurn = false;
    showMessage(data.message, 'success');
  });

  socket.on('bet_error', function(data) {
    $scope.betError = data.message;
  });

  socket.on('hand_dealt', function(data) {
    $scope.myHand = data.hand;
  });

  socket.on('table_updated', function(data) {
    $scope.tableCards = data.tableCards;
  });

  socket.on('trick_resolved', function(data) {
    if (data.isTie) {
      // Usar a mesma func, porém com formatação se precisarmos, por enquanto 'error' serve pra destaque
      showMessage('🔥 Bucha! Ninguém levou a vaza!', 'error');
    } else {
      showMessage('🏆 ' + data.winnerName + ' levou a mão!', 'success');
    }
  });

  socket.on('error', function(data) {
    showMessage(data.message, 'error');
  });

  // Funções Auxiliares Visuais para o Baralho Espanhol
  $scope.getSuitSymbol = function(suit) {
    switch(suit) {
      case 'ouros': return '🟡';
      case 'copas': return '🍷';
      case 'espadas': return '⚔️';
      case 'paus': return '🌿';
      default: return '';
    }
  };

  $scope.getCardColor = function(suit) {
    switch(suit) {
      case 'ouros': return '#F59E0B'; // Dourado
      case 'copas': return '#EF4444'; // Vermelho Vivo
      case 'espadas': return '#3B82F6'; // Azul Claro/Prata
      case 'paus': return '#10B981'; // Verde Neon
      default: return '#333';
    }
  };
});
