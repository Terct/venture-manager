const express = require('express');
const bodyParser = require('body-parser');
const { createClient } = require('@supabase/supabase-js');
const jwt = require('jsonwebtoken');
const bcrypt = require('bcrypt');
require('dotenv').config();
const moment = require('moment-timezone');
const fs = require('fs').promises;
const axios = require('axios');
const crypto = require('crypto');
const { v4: uuidv4 } = require('uuid');



const app = express();

const port = 61854

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_KEY;
const supabase = createClient(supabaseUrl, supabaseKey);

// Configurando o body-parser para lidar com payloads grandes (10MB)
app.use(bodyParser.json({ limit: '1024mb' }));
app.use(bodyParser.urlencoded({ limit: '1024mb', extended: true }));

app.use(bodyParser.json());

app.post('/register', async (req, res) => {
  try {
    const { email, password } = req.body;

    // Verificar se o e-mail já está registrado
    const { data: existingUser } = await supabase
      .from('venture_manager_users')
      .select('id')
      .eq('email', email);

    if (existingUser && existingUser.length > 0) {
      return res.status(400).json({ error: 'E-mail já registrado' });
    }

    // Criptografar a senha antes de armazená-la
    const hashedPassword = await bcrypt.hash(password, 10);

    // Inserir usuário no banco de dados
    const { data: newUser, error } = await supabase
      .from('venture_manager_users')
      .insert([{ email: email, pass: hashedPassword }]);

    if (error) {
      throw error;
    }

    res.status(201).json({ message: 'Registro bem-sucedido' });
  } catch (error) {
    console.error('Erro no registro:', error);
    res.status(500).json({ error: 'Erro interno no servidor' });
  }
});

app.post('/login', async (req, res) => {
  try {
    const { email, password } = req.body;

    // Obter usuário pelo e-mail
    const { data: users } = await supabase
      .from('venture_manager_users')
      .select('id, email, pass')
      .eq('email', email);

    if (!users || users.length === 0) {
      return res.status(401).json({ error: 'O usuário não existe' });
    }

    // Verificar a senha
    const user = users[0];
    const passwordMatch = await bcrypt.compare(password, user.pass);

    if (!passwordMatch) {
      return res.status(401).json({ error: 'Senha inválida' });
    }

    // Gerar token JWT
    const token = jwt.sign({ userId: user.id }, process.env.JWT_SECRET, {
      expiresIn: '5h', // Token expira em 1 hora
    });

    res.status(200).json({ token });
  } catch (error) {
    console.error('Erro no login:', error);
    res.status(500).json({ error: 'Erro interno no servidor' });
  }
});

app.post('/search-ventures', async (req, res) => {
  try {
    const { jwt: token } = req.body;



    // Verificar se o token é válido
    const decodedToken = jwt.verify(token, process.env.JWT_SECRET);


    // Obter usuário pelo ID do token
    const { data: users } = await supabase
      .from('venture_manager_users')
      .select('ventures')
      .eq('id', decodedToken.userId);



    if (!users || users.length === 0) {
      return res.status(401).json({ error: 'Usuário não encontrado' });
    }



    res.status(200).json(users[0].ventures.reverse());
  } catch (error) {
    console.error('Erro na pesquisa de perfil:', error);
    res.status(500).json({ error: 'Erro interno no servidor' });
  }
});

app.post('/search-updates', async (req, res) => {
  try {
    const { jwt: token } = req.body;



    // Verificar se o token é válido
    const decodedToken = jwt.verify(token, process.env.JWT_SECRET);


    // Obter usuário pelo ID do token
    const { data: users } = await supabase
      .from('venture_manager_users')
      .select('openai_lastUpdate')
      .eq('id', decodedToken.userId);



    if (!users || users.length === 0) {
      return res.status(401).json({ error: 'Usuário não encontrado' });
    }



    res.status(200).json(users[0].openai_lastUpdate);
  } catch (error) {
    console.error('Erro na pesquisa de perfil:', error);
    res.status(500).json({ error: 'Erro interno no servidor' });
  }
});

app.post('/update-baseIA', async (req, res) => {
  try {
    const { jwt: token } = req.body;

    // Verificar se o token é válido
    const decodedToken = jwt.verify(token, process.env.JWT_SECRET);

    // Obter usuário pelo ID do token
    const { data: users } = await supabase
      .from('venture_manager_users')
      .select('*')
      .eq('id', decodedToken.userId);

    if (!users || users.length === 0) {
      return res.status(401).json({ error: 'Usuário não encontrado' });
    }

    const data = users[0].ventures;
    const url = users[0].n8n_url;
    const apikey = users[0].n8n_apikey;

    // Enviar dados para o webhook
    await axios.post(`${url}/webhook/update-base`, {
      data: data
    }, {
      headers: {
        'x-api-key': apikey
      }
    });


    // Atualizar usuário com o novo item na coluna ventures
    const { data: updatedUser, error: updateError } = await supabase
      .from('venture_manager_users')
      .update({ openai_lastUpdate: moment() })
      .eq('id', decodedToken.userId)
      .single();

    if (updateError) {
      return res.status(500).json({ error: 'Erro ao atualizar usuário' });
    }


    res.status(200).json('Base atualizada com sucesso!');
  } catch (error) {
    console.error('Erro na pesquisa de perfil:', error);
    res.status(500).json({ error: 'Erro interno no servidor' });
  }
});

app.post('/manage-ventures', async (req, res) => {
  try {
    const { jwt: token, newItem, images, action } = req.body;

    // Verificar se o token é válido
    const decodedToken = jwt.verify(token, process.env.JWT_SECRET);

    // Obter usuário pelo ID do token
    const { data: users, error } = await supabase
      .from('venture_manager_users')
      .select('ventures')
      .eq('id', decodedToken.userId)
      .single();

    if (error) {
      return res.status(500).json({ error: 'Erro ao buscar usuário' });
    }

    if (!users) {
      return res.status(401).json({ error: 'Usuário não encontrado' });
    }

    // Verificar se já existe outro empreendimento com o mesmo nome
    const existingIndex = users.ventures.findIndex(venture => venture.idSpace === newItem.idSpace);
    if (existingIndex !== -1 && action !== 'edit') {
      return res.status(400).json({ error: 'Já existe um empreendimento com este ID' });
    }

    const updatedVentures = [...users.ventures];
    if (action === 'edit') {
      // Encontrar o item pelo idSpace e atualizá-lo
      if (existingIndex !== -1) {
        updatedVentures[existingIndex] = {
          idSpace: newItem.idSpace,
          nome: newItem.name,
          preco: `R$ ${newItem.price}`,
          imagens: images.map(image => ({
            link: image.url,
            descrição: image.description
          })),
          descricao: newItem.description,
          localizacao: newItem.localization
        };
      } else {
        return res.status(404).json({ error: 'Item não encontrado para edição' });
      }
    } else {
      // Adicionar novo item ao array de empreendimentos
      updatedVentures.push({
        idSpace: newItem.idSpace,
        nome: newItem.name,
        preco: `R$ ${newItem.price}`,
        imagens: images.map(image => ({
          link: image.url,
          descrição: image.description
        })),
        descricao: newItem.description,
        localizacao: newItem.localization
      });
    }

    // Atualizar usuário com o novo item na coluna ventures
    const { data: updatedUser, error: updateError } = await supabase
      .from('venture_manager_users')
      .update({ ventures: updatedVentures })
      .eq('id', decodedToken.userId)
      .single();

    if (updateError) {
      return res.status(500).json({ error: 'Erro ao atualizar usuário' });
    }

    res.status(200).json({ message: 'Empreendimento ' + (action === 'edit' ? 'editado' : 'adicionado') + ' com sucesso!' });
  } catch (error) {
    console.error('Erro ao adicionar/Editar empreendimento:', error);
    res.status(500).json({ error: 'Erro interno no servidor' });
  }
});

app.delete('/delete-venture', async (req, res) => {
  try {
    const { jwt: token } = req.body;
    const { idSpace } = req.query;

    // Verificar se o token é válido
    const decodedToken = jwt.verify(token, process.env.JWT_SECRET);

    // Obter usuário pelo ID do token
    const { data: users, error } = await supabase
      .from('venture_manager_users')
      .select('ventures')
      .eq('id', decodedToken.userId)
      .single();

    if (error) {
      return res.status(500).json({ error: 'Erro ao buscar usuário' });
    }

    if (!users) {
      return res.status(401).json({ error: 'Usuário não encontrado' });
    }

    // Verificar se o empreendimento com o idSpace fornecido existe
    const ventureIndex = users.ventures.findIndex(venture => venture.idSpace === idSpace);
    if (ventureIndex === -1) {
      return res.status(404).json({ error: 'Empreendimento não encontrado' });
    }

    // Remover o empreendimento do array de empreendimentos
    const updatedVentures = users.ventures.filter(venture => venture.idSpace !== idSpace);

    // Atualizar usuário removendo o empreendimento da coluna ventures
    const { data: updatedUser, error: updateError } = await supabase
      .from('venture_manager_users')
      .update({ ventures: updatedVentures })
      .eq('id', decodedToken.userId)
      .single();

    if (updateError) {
      return res.status(500).json({ error: 'Erro ao atualizar usuário' });
    }

    // Obter todos os itens com idSpace igual ao fornecido pela requisição
    const { data: filesToDelete, error: filesError } = await supabase
      .from('venture_manager_files')
      .select()
      .eq('idSpace', idSpace);

    if (filesError) {
      console.error('Erro ao buscar arquivos:', filesError);
      return res.status(500).json({ error: 'Erro ao buscar arquivos' });
    }

    // Deletar todos os itens encontrados da tabela venture_manager_files
    for (const file of filesToDelete) {
      await supabase.from('venture_manager_files').delete().eq('id', file.id);
    }

    // Deletar os arquivos correspondentes no armazenamento
    for (const file of filesToDelete) {
      const { data: removedFile, error: removeError } = await supabase.storage
        .from('venture_manager_files')
        .remove(`images/${idSpace}/${file.filename}`);

      if (removeError) {
        console.error(`Erro ao remover arquivo ${file.filename}:`, removeError);
        return res.status(500).json({ error: 'Erro ao remover arquivos' });
      }
    }

    res.status(200).json({ message: 'Arquivos e registros deletados com sucesso!' });
  } catch (error) {
    console.error('Erro ao deletar arquivos e registros:', error);
    res.status(500).json({ error: 'Erro interno no servidor' });
  }
});

app.post('/upload-image', async (req, res) => {
  try {
    const { jwt: token, images, idSpace } = req.body;

    // Verificar se o token é válido
    const decodedToken = jwt.verify(token, process.env.JWT_SECRET);

    // Obter usuário pelo ID do token
    const { data: user } = await supabase
      .from('venture_manager_users')
      .select('id')
      .eq('id', decodedToken.userId);

    if (!user || user.length === 0) {
      return res.status(401).json({ error: 'Usuário não encontrado' });
    }

    // Loop pelas imagens e as salve no bucket
    for (const image of images) {
      var imagemBuffer = Buffer.from(image.data.split(',')[1], 'base64')
      //console.log(imagemBuffer)

      // Gerar um nome de imagem único usando uuid
      const imageName = uuidv4();

      const { data, error } = await supabase.storage
        .from('venture_manager_files')
        .upload(`images/${idSpace}/${imageName}`, imagemBuffer, {
          contentType: image.meta.type || "image/jpeg",
          cacheControl: '3600',
        });

      if (error) {
        console.error('Erro ao salvar imagem:', error);
        return res.status(500).json({ error: 'Erro ao salvar imagem' });
      }

      const baseUrl = process.env.SUPABASE_URL;

      // Salvar informações da imagem no banco de dados
      const { data: insertedImage, error: insertError } = await supabase
        .from('venture_manager_files')
        .insert([{
          filename: imageName, url: `${baseUrl}/storage/v1/object/public/venture_manager_files/images/${idSpace}/${imageName}`,
          idSpace: idSpace

        }]);

      if (insertError) {
        console.error('Erro ao salvar informações da imagem no banco de dados:', insertError);
        return res.status(500).json({ error: 'Erro ao salvar imagem' });
      }

    }

    res.status(200).json({ message: 'Imagens salvas com sucesso' });
  } catch (error) {
    console.error('Erro ao salvar imagens:', error);
    res.status(500).json({ error: 'Erro interno no servidor' });
  }
});

app.post('/update-image', async (req, res) => {
  try {
    const { jwt: token } = req.body;
    const { idSpace, imageId, description } = req.query;

    // Verificar se o token é válido
    const decodedToken = jwt.verify(token, process.env.JWT_SECRET);

    // Obter usuário pelo ID do token
    const { data: user } = await supabase
      .from('venture_manager_users')
      .select('id')
      .eq('id', decodedToken.userId);

    if (!user || user.length === 0) {
      return res.status(401).json({ error: 'Usuário não encontrado' });
    }

    // Atualizar o perfil do usuário no banco de dados
    const { data: updatedUser, error } = await supabase
      .from('venture_manager_files')
      .update({ description: description })
      .eq('idSpace', idSpace)
      .eq('filename', imageId);

    if (error) {
      throw error;
    }

    res.status(200).json({ message: 'Imagens atualizadas com sucesso' });
  } catch (error) {
    console.error('Erro ao atualizar imagens:', error);
    res.status(500).json({ error: 'Erro interno no servidor' });
  }
});

app.get('/get-images/:idSpace', async (req, res) => {
  try {
    const { idSpace } = req.params;

    // Lista os arquivos do diretório especificado
    const { data: files, error } = await supabase
      .from('venture_manager_files')
      .select(`*`)
      .eq('idSpace', idSpace);

    if (error) {
      console.error('Erro ao listar arquivos:', error);
      return res.status(500).json({ error: 'Erro ao listar arquivos' });
    }

    // Retorna a lista de arquivos com os links
    res.status(200).json(files);
  } catch (error) {
    console.error('Erro ao buscar arquivos:', error);
    res.status(500).json({ error: 'Erro interno no servidor' });
  }
});

app.delete('/delete-image', async (req, res) => {
  try {
    const { idSpace, imageId } = req.query;
    const { jwt: token } = req.body;

    //console.log(idSpace, imageId)

    // Verificar se o token é válido
    const decodedToken = jwt.verify(token, process.env.JWT_SECRET);

    // Verificar se o ID do usuário é válido (você pode adicionar mais verificações aqui conforme necessário)
    if (!decodedToken.userId) {
      return res.status(401).json({ error: 'Token inválido ou expirado' });
    }

    // Deletar a imagem do armazenamento
    const { data, error } = await supabase.storage
      .from('venture_manager_files')
      .remove(`images/${idSpace}/${imageId}`);

    if (error) {
      console.error('Erro ao deletar imagem:', error);
      return res.status(500).json({ error: 'Erro ao deletar imagem' });
    }

    // Deletar a imagem do armazenamento
    const { dataMeta, errorMeta } = await supabase
      .from('venture_manager_files')
      .delete()
      .eq('idSpace', idSpace)
      .eq('filename', imageId);

    if (error) {
      console.error('Erro ao deletar imagem:', error);
      return res.status(500).json({ error: 'Erro ao deletar imagem' });
    }


    // Verificar se a imagem foi deletada com sucesso
    if (data) {
      res.status(200).json({ message: 'Imagem deletada com sucesso' });
    } else {
      res.status(404).json({ error: 'Imagem não encontrada' });
    }
  } catch (error) {
    console.error('Erro ao deletar imagem:', error);
    res.status(500).json({ error: 'Erro interno no servidor' });
  }
});



app.listen(port, () => {
  console.log(`Servidor principal rodando na porta ${port}`);
});


